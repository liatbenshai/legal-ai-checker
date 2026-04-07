"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  Usb,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ── Public handle exposed via ref ──────────────────────────────────
export interface AudioPlayerHandle {
  /** Jump to `seconds` with a 20-second pre-roll and auto-play. */
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
}

interface AudioPlayerProps {
  audioFile: File;
  onTimeUpdate?: (currentTime: number) => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const PRE_ROLL_SECONDS = 20;
const BACKSTEP_SECONDS = 2;

// ── WebHID types (subset) ──────────────────────────────────────────
interface HIDDeviceRef {
  device: HIDDevice;
  cleanup: () => void;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ audioFile, onTimeUpdate }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<import("wavesurfer.js").default | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [isMuted, setIsMuted] = useState(false);
    const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
    const [isReady, setIsReady] = useState(false);
    const [speedOpen, setSpeedOpen] = useState(false);

    // Foot-pedal state
    const [pedalStatus, setPedalStatus] = useState<
      "disconnected" | "connecting" | "connected" | "unsupported"
    >("disconnected");
    const hidRef = useRef<HIDDeviceRef | null>(null);
    const pedalHeldRef = useRef(false);

    // ── helpers ────────────────────────────────────────────────────
    const wsPlay = useCallback(() => {
      wavesurferRef.current?.play();
    }, []);

    const wsPause = useCallback(() => {
      wavesurferRef.current?.pause();
    }, []);

    const wsSeekRaw = useCallback(
      (seconds: number) => {
        const ws = wavesurferRef.current;
        if (!ws || duration === 0) return;
        const clamped = Math.max(0, Math.min(duration, seconds));
        ws.seekTo(clamped / duration);
      },
      [duration]
    );

    // ── imperative handle ──────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        const target = Math.max(0, seconds - PRE_ROLL_SECONDS);
        wsSeekRaw(target);
        wsPlay();
      },
      getCurrentTime: () => currentTime,
    }));

    // ── wavesurfer initialisation ──────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return;

      let ws: import("wavesurfer.js").default | null = null;

      import("wavesurfer.js").then((WaveSurfer) => {
        if (!containerRef.current) return;

        ws = WaveSurfer.default.create({
          container: containerRef.current,
          waveColor: "#c7d2fe",
          progressColor: "#4f46e5",
          cursorColor: "#4f46e5",
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 48,
          normalize: true,
          backend: "WebAudio",
        });

        const url = URL.createObjectURL(audioFile);
        ws.load(url);

        ws.on("ready", () => {
          setDuration(ws!.getDuration());
          setIsReady(true);
          ws!.setVolume(volume);
          ws!.setPlaybackRate(speed);
        });

        ws.on("audioprocess", () => {
          const t = ws!.getCurrentTime();
          setCurrentTime(t);
          onTimeUpdate?.(t);
        });

        ws.on("seeking", () => {
          const t = ws!.getCurrentTime();
          setCurrentTime(t);
          onTimeUpdate?.(t);
        });

        ws.on("play", () => setIsPlaying(true));
        ws.on("pause", () => setIsPlaying(false));
        ws.on("finish", () => setIsPlaying(false));

        wavesurferRef.current = ws;
      });

      return () => {
        if (ws) {
          ws.destroy();
          wavesurferRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioFile]);

    // ── transport ──────────────────────────────────────────────────
    const togglePlay = useCallback(() => {
      wavesurferRef.current?.playPause();
    }, []);

    const skip = useCallback(
      (seconds: number) => {
        wsSeekRaw(currentTime + seconds);
      },
      [currentTime, wsSeekRaw]
    );

    const toggleMute = useCallback(() => {
      const ws = wavesurferRef.current;
      if (!ws) return;
      if (isMuted) {
        ws.setVolume(volume);
        setIsMuted(false);
      } else {
        ws.setVolume(0);
        setIsMuted(true);
      }
    }, [isMuted, volume]);

    const handleVolumeChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setVolume(val);
        setIsMuted(val === 0);
        wavesurferRef.current?.setVolume(val);
      },
      []
    );

    const setPlaybackSpeed = useCallback(
      (newSpeed: (typeof SPEED_OPTIONS)[number]) => {
        setSpeed(newSpeed);
        wavesurferRef.current?.setPlaybackRate(newSpeed);
        setSpeedOpen(false);
      },
      []
    );

    // ── Foot-pedal: auto-backstep on pause ─────────────────────────
    const pauseWithBackstep = useCallback(() => {
      wsPause();
      // rewind by BACKSTEP_SECONDS so user regains context on next play
      const ws = wavesurferRef.current;
      if (ws && duration > 0) {
        const newTime = Math.max(0, ws.getCurrentTime() - BACKSTEP_SECONDS);
        ws.seekTo(newTime / duration);
      }
    }, [wsPause, duration]);

    // ── WebHID foot-pedal ──────────────────────────────────────────
    const connectPedal = useCallback(async () => {
      if (!("hid" in navigator)) {
        setPedalStatus("unsupported");
        return;
      }

      setPedalStatus("connecting");

      try {
        // Infinity IN-USB-2 vendorId = 0x05F3
        const devices = await navigator.hid!.requestDevice({
          filters: [{ vendorId: 0x05f3 }],
        });

        const device = devices[0];
        if (!device) {
          setPedalStatus("disconnected");
          return;
        }

        await device.open();

        const onInputReport = (e: HIDInputReportEvent) => {
          const data = new Uint8Array(e.data.buffer);
          const pressed = data[0] ?? 0;

          // Typical Infinity IN-USB-2 mapping:
          //   0x00 = all released
          //   0x02 = center pedal
          //   0x01 = left pedal
          //   0x04 = right pedal
          if (pressed === 0x02) {
            // Center pedal pressed → play
            pedalHeldRef.current = true;
            wsPlay();
          } else if (pressed === 0x00 && pedalHeldRef.current) {
            // Center pedal released → pause with backstep
            pedalHeldRef.current = false;
            pauseWithBackstep();
          } else if (pressed === 0x01) {
            // Left pedal → rewind 5s
            skip(-5);
          } else if (pressed === 0x04) {
            // Right pedal → fast-forward 5s
            skip(5);
          }
        };

        device.addEventListener("inputreport", onInputReport);
        hidRef.current = {
          device,
          cleanup: () =>
            device.removeEventListener("inputreport", onInputReport),
        };

        setPedalStatus("connected");
      } catch {
        setPedalStatus("disconnected");
      }
    }, [wsPlay, pauseWithBackstep, skip]);

    // Cleanup HID on unmount
    useEffect(() => {
      return () => {
        if (hidRef.current) {
          hidRef.current.cleanup();
          hidRef.current.device.close();
          hidRef.current = null;
        }
      };
    }, []);

    // ── Keyboard shortcuts ─────────────────────────────────────────
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        ) {
          return;
        }

        switch (e.code) {
          case "Space":
            e.preventDefault();
            togglePlay();
            break;
          case "ArrowRight":
            e.preventDefault();
            skip(-5); // RTL: right = backward
            break;
          case "ArrowLeft":
            e.preventDefault();
            skip(5); // RTL: left = forward
            break;
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [togglePlay, skip]);

    // Close speed dropdown on outside click
    useEffect(() => {
      if (!speedOpen) return;
      const close = () => setSpeedOpen(false);
      window.addEventListener("click", close);
      return () => window.removeEventListener("click", close);
    }, [speedOpen]);

    // ── format ─────────────────────────────────────────────────────
    const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    // ── render ─────────────────────────────────────────────────────
    return (
      <Card className="border-indigo/20 bg-white/95 shadow-lg backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            {/* Waveform */}
            <div
              ref={containerRef}
              className={`w-full rounded-lg bg-slate-50 ${!isReady ? "animate-pulse" : ""}`}
            />

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Transport */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => skip(-5)}
                  disabled={!isReady}
                  title="5 שניות אחורה"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>

                <Button
                  variant="default"
                  size="icon"
                  onClick={togglePlay}
                  disabled={!isReady}
                  className="bg-indigo text-white hover:bg-indigo-dark"
                  title={isPlaying ? "השהה" : "נגן"}
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5 mr-[-2px]" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => skip(5)}
                  disabled={!isReady}
                  title="5 שניות קדימה"
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>

              {/* Time */}
              <div className="min-w-[100px] text-center font-mono text-sm text-muted-foreground">
                <span className="text-foreground">
                  {formatTime(currentTime)}
                </span>
                {" / "}
                {formatTime(duration)}
              </div>

              {/* Speed dropdown */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 font-mono text-xs"
                  title="מהירות ניגון"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSpeedOpen((v) => !v);
                  }}
                >
                  {speed}x
                </Button>
                {speedOpen && (
                  <div className="absolute bottom-full right-0 mb-1 min-w-[80px] rounded-lg border bg-white py-1 shadow-lg">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlaybackSpeed(s);
                        }}
                        className={`block w-full px-3 py-1.5 text-right font-mono text-sm transition-colors ${
                          s === speed
                            ? "bg-indigo/10 font-bold text-indigo"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Volume */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleMute}
                  title={isMuted ? "בטל השתקה" : "השתק"}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="h-1 w-20 cursor-pointer accent-indigo"
                  title="עוצמת שמע"
                />
              </div>

              {/* Separator */}
              <div className="h-6 w-px bg-border" />

              {/* Foot pedal connect */}
              <Button
                variant="outline"
                size="sm"
                onClick={connectPedal}
                disabled={
                  pedalStatus === "connected" ||
                  pedalStatus === "unsupported" ||
                  pedalStatus === "connecting"
                }
                className={`gap-1.5 text-xs ${
                  pedalStatus === "connected"
                    ? "border-emerald/30 text-emerald"
                    : pedalStatus === "unsupported"
                      ? "border-rose/30 text-rose"
                      : ""
                }`}
                title="חיבור דוושת תמלול USB (Infinity IN-USB-2/3)"
              >
                {pedalStatus === "connected" ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    דוושה מחוברת
                  </>
                ) : pedalStatus === "unsupported" ? (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    WebHID לא נתמך
                  </>
                ) : pedalStatus === "connecting" ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo/20 border-t-indigo" />
                    מתחבר...
                  </>
                ) : (
                  <>
                    <Usb className="h-3.5 w-3.5" />
                    חבר דוושה
                  </>
                )}
              </Button>

              {/* Keyboard hints */}
              <div className="mr-auto text-xs text-muted-foreground">
                <kbd className="rounded border bg-muted px-1.5 py-0.5">
                  Space
                </kbd>{" "}
                ניגון{" "}
                <kbd className="rounded border bg-muted px-1.5 py-0.5">
                  &larr;&rarr;
                </kbd>{" "}
                ±5שׁ
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
);

export default AudioPlayer;
