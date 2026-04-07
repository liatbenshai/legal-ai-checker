"use client";

import { useState, useRef, useCallback } from "react";
import {
  Sparkles,
  Scale,
  ShieldCheck,
  ArrowLeft,
  FileText,
  Mic,
  Brain,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Home,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import FileUploadZone from "@/components/FileUploadZone";
import AnalysisResults from "@/components/AnalysisResults";
import AudioPlayer, { type AudioPlayerHandle } from "@/components/AudioPlayer";
import type { Discrepancy, AnalysisStep } from "@/lib/types";

const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB

const INITIAL_STEPS: AnalysisStep[] = [
  { id: "pdf", label: "חילוץ טקסט מה-PDF", status: "pending" },
  { id: "upload", label: "העלאת האודיו לשרת", status: "pending" },
  { id: "audio", label: "תמלול האודיו עם Whisper", status: "pending" },
  { id: "analyze", label: "ניתוח והשוואה עם GPT-4o", status: "pending" },
];

export default function AnalyzePage() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [steps, setSteps] = useState<AnalysisStep[]>(INITIAL_STEPS);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);

  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const canAnalyze = audioFile && pdfFile && !isAnalyzing;

  const updateStep = (
    id: string,
    status: AnalysisStep["status"],
    errorMessage?: string
  ) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status, errorMessage } : s))
    );
  };

  const progressPercent = () => {
    const completed = steps.filter((s) => s.status === "completed").length;
    const inProgress = steps.filter((s) => s.status === "in_progress").length;
    return Math.round(((completed + inProgress * 0.5) / steps.length) * 100);
  };

  const handleStartAnalysis = async () => {
    if (!canAnalyze) return;
    setIsAnalyzing(true);
    setDiscrepancies(null);
    setError(null);
    setSteps(INITIAL_STEPS);
    setTranscriptId(null);

    try {
      // ── Step 1: Extract PDF text ──────────────────────────────
      updateStep("pdf", "in_progress");
      const pdfFormData = new FormData();
      pdfFormData.append("file", pdfFile);
      const pdfRes = await fetch("/api/extract-pdf", { method: "POST", body: pdfFormData });
      const pdfData = await pdfRes.json();
      if (!pdfRes.ok) throw new Error(pdfData.error || "שגיאה בחילוץ ה-PDF");
      if (pdfData.isScanned) {
        updateStep("pdf", "error", pdfData.warning);
        throw new Error(pdfData.warning);
      }
      updateStep("pdf", "completed");

      // ── Step 2: Upload audio directly to Supabase Storage ─────
      //    (browser → Supabase, bypasses Vercel 4.5MB limit)
      updateStep("upload", "in_progress");

      if (audioFile.size > MAX_AUDIO_SIZE) {
        throw new Error(
          `הקובץ גדול מדי (${(audioFile.size / 1024 / 1024).toFixed(0)}MB). אנא העלו קובץ קטן מ-100MB או פצלו אותו.`
        );
      }

      const supabase = createClient();
      const timestamp = Date.now();
      const safeName = audioFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `uploads/${timestamp}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("audio-files")
        .upload(storagePath, audioFile, {
          contentType: audioFile.type || "audio/mpeg",
          upsert: false,
        });

      if (uploadError) {
        console.error("Supabase upload error:", uploadError);
        throw new Error("שגיאה בהעלאת קובץ האודיו לשרת. בדקו הרשאות אחסון ב-Supabase.");
      }

      // Get a signed URL valid for 1 hour
      const { data: urlData, error: urlError } = await supabase.storage
        .from("audio-files")
        .createSignedUrl(storagePath, 3600);

      if (urlError || !urlData?.signedUrl) {
        throw new Error("שגיאה ביצירת קישור לקובץ האודיו");
      }

      updateStep("upload", "completed");

      // ── Step 3: Transcribe via URL (tiny JSON, no body limit) ─
      updateStep("audio", "in_progress");
      const audioRes = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: urlData.signedUrl,
          fileName: audioFile.name,
        }),
      });
      const audioData = await audioRes.json();
      if (!audioRes.ok) throw new Error(audioData.error || "שגיאה בתמלול האודיו");
      updateStep("audio", "completed");

      // ── Step 4: Analyze discrepancies ─────────────────────────
      updateStep("analyze", "in_progress");
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfText: pdfData.text, whisperText: audioData.text }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error || "שגיאה בניתוח");
      updateStep("analyze", "completed");
      setDiscrepancies(analyzeData.discrepancies);
    } catch (err) {
      const message = err instanceof Error ? err.message : "אירעה שגיאה בלתי צפויה";
      setError(message);
      setSteps((prev) =>
        prev.map((s) =>
          s.status === "in_progress" ? { ...s, status: "error", errorMessage: message } : s
        )
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setAudioFile(null);
    setPdfFile(null);
    setDiscrepancies(null);
    setError(null);
    setSteps(INITIAL_STEPS);
    setTranscriptId(null);
    setCurrentAudioTime(0);
  };

  const handleTimestampClick = useCallback((timestamp: string) => {
    const parts = timestamp.split(":").map(Number);
    const seconds = (parts[0] || 0) * 60 + (parts[1] || 0);
    audioPlayerRef.current?.seekTo(seconds);
  }, []);

  const handleExportDocx = useCallback(
    async (exportDiscrepancies: Discrepancy[]) => {
      const { generateLegalDocx } = await import("@/lib/export-legal");
      const { Packer } = await import("docx");
      const { saveAs } = await import("file-saver");
      const doc = generateLegalDocx({
        fileName: pdfFile?.name || "ניתוח",
        discrepancies: exportDiscrepancies,
      });
      const blob = await Packer.toBlob(doc);
      saveAs(blob, `בקשה-לתיקון-פרוטוקול-${new Date().toISOString().slice(0, 10)}.docx`);
    },
    [pdfFile]
  );

  const handleSave = useCallback(
    async (updatedDiscrepancies: Discrepancy[]) => {
      const res = await fetch("/api/save-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptId,
          fileName: pdfFile?.name || "unknown",
          discrepancies: updatedDiscrepancies,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (!transcriptId && data.id) setTranscriptId(data.id);
    },
    [transcriptId, pdfFile]
  );

  const showResults = discrepancies && !isAnalyzing;

  return (
    <div className="min-h-screen bg-gradient-to-bl from-slate-50 via-indigo-50/30 to-violet-50/20">
      {/* Header */}
      <header className="border-b border-border/50 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo text-white shadow-md shadow-indigo/25">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">זיהוי שגיאות AI</h1>
              <p className="text-xs text-muted-foreground">ניתוח חדש</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Home className="h-4 w-4" />
                לוח בקרה
              </Button>
            </Link>
            <div className="flex items-center gap-2 rounded-full bg-emerald/10 px-3 py-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald" />
              <span className="text-xs font-medium text-emerald-dark">מאובטח</span>
            </div>
          </div>
        </div>
      </header>

      <main className={`mx-auto max-w-6xl px-6 py-12 ${showResults && audioFile ? "pb-36" : ""}`}>
        {/* Hero */}
        <div className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-violet/10 px-4 py-1.5">
            <Sparkles className="h-4 w-4 text-violet" />
            <span className="text-sm font-medium text-violet">מבוסס בינה מלאכותית</span>
          </div>
          <h2 className="text-4xl font-extrabold tracking-tight text-foreground">ניתוח חדש</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            העלו קובץ אודיו ותמלול PDF — המערכת תזהה אי-התאמות באופן אוטומטי
          </p>
        </div>

        {/* Upload Section */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-indigo" />
              <h3 className="text-sm font-semibold text-foreground">שלב 1: קובץ אודיו</h3>
            </div>
            <FileUploadZone
              type="audio"
              onFileSelect={setAudioFile}
              onFileRemove={() => setAudioFile(null)}
              selectedFile={audioFile}
            />
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-violet" />
              <h3 className="text-sm font-semibold text-foreground">שלב 2: קובץ תמלול</h3>
            </div>
            <FileUploadZone
              type="pdf"
              onFileSelect={setPdfFile}
              onFileRemove={() => setPdfFile(null)}
              selectedFile={pdfFile}
            />
          </div>
        </div>

        {/* Analysis Button */}
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button
            size="lg"
            onClick={handleStartAnalysis}
            disabled={!canAnalyze}
            className="gap-2 bg-indigo px-10 py-6 text-lg font-bold text-white shadow-lg shadow-indigo/25 transition-all hover:bg-indigo-dark hover:shadow-xl hover:shadow-indigo/30 disabled:opacity-50 disabled:shadow-none"
          >
            {isAnalyzing ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                מנתח...
              </>
            ) : (
              <>
                התחל ניתוח
                <ArrowLeft className="h-5 w-5" />
              </>
            )}
          </Button>
          {(discrepancies || error) && !isAnalyzing && (
            <Button size="lg" variant="outline" onClick={handleReset} className="gap-2 py-6">
              <RotateCcw className="h-5 w-5" />
              ניתוח חדש
            </Button>
          )}
        </div>

        {/* Progress Steps */}
        {(isAnalyzing || discrepancies || error) && (
          <Card className="mx-auto mt-8 max-w-2xl border-indigo/20">
            <CardContent className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">התקדמות הניתוח</p>
                <span className="text-sm font-medium text-indigo">{progressPercent()}%</span>
              </div>
              <Progress value={progressPercent()} className="mb-6 h-2" />
              <div className="space-y-4">
                {steps.map((step) => {
                  const StepIcon = step.id === "pdf" ? FileText : step.id === "upload" ? Upload : step.id === "audio" ? Mic : Brain;
                  return (
                    <div key={step.id} className="flex items-center gap-3">
                      {step.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald" />
                      ) : step.status === "error" ? (
                        <XCircle className="h-5 w-5 shrink-0 text-rose" />
                      ) : step.status === "in_progress" ? (
                        <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo/20 border-t-indigo" />
                      ) : (
                        <StepIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${step.status === "completed" ? "text-emerald" : step.status === "error" ? "text-rose" : step.status === "in_progress" ? "text-indigo" : "text-muted-foreground"}`}>
                          {step.label}
                        </p>
                        {step.errorMessage && <p className="mt-0.5 text-xs text-rose">{step.errorMessage}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {error && !isAnalyzing && (
          <Card className="mx-auto mt-6 max-w-2xl border-rose/30 bg-rose/5">
            <CardContent className="flex items-center gap-3 p-6">
              <XCircle className="h-6 w-6 shrink-0 text-rose" />
              <div>
                <p className="font-semibold text-rose">שגיאה בתהליך הניתוח</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {showResults && (
          <div className="mt-10">
            <AnalysisResults
              discrepancies={discrepancies}
              currentAudioTime={currentAudioTime}
              onTimestampClick={handleTimestampClick}
              onDiscrepanciesChange={setDiscrepancies}
              onSave={handleSave}
              onExportDocx={handleExportDocx}
            />
          </div>
        )}
      </main>

      {showResults && audioFile && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-indigo/20 bg-white/95 px-6 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm">
          <div className="mx-auto max-w-6xl">
            <AudioPlayer ref={audioPlayerRef} audioFile={audioFile} onTimeUpdate={setCurrentAudioTime} />
          </div>
        </div>
      )}

      {!showResults && (
        <footer className="mt-auto border-t border-border/50 bg-white/50 py-6 text-center text-sm text-muted-foreground">
          <p>מערכת זיהוי שגיאות בתמלול משפטי &copy; {new Date().getFullYear()}</p>
        </footer>
      )}
    </div>
  );
}
