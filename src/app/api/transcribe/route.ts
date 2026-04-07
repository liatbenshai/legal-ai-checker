import { NextRequest } from "next/server";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";
import type { WhisperSegment, TranscriptionResult } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25MB
const CHUNK_DURATION_SECONDS = 600; // 10 minutes per chunk

/**
 * Resolve ffmpeg binary path — works locally with ffmpeg-static
 * and on Vercel/serverless where ffmpeg-static may not work.
 */
function getFfmpegPath(): string | null {
  // 1. Try ffmpeg-static (works locally, may fail on serverless)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require("ffmpeg-static") as string;
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      console.log("[transcribe] Using ffmpeg-static:", ffmpegStatic);
      return ffmpegStatic;
    }
  } catch {
    console.warn("[transcribe] ffmpeg-static not available");
  }

  // 2. Try system ffmpeg (available in some serverless runtimes)
  try {
    const { execSync } = require("child_process");
    const systemPath = execSync("which ffmpeg 2>/dev/null || where ffmpeg 2>nul", {
      encoding: "utf-8",
    }).trim();
    if (systemPath) {
      console.log("[transcribe] Using system ffmpeg:", systemPath);
      return systemPath;
    }
  } catch {
    // not found
  }

  console.warn("[transcribe] No ffmpeg binary found — chunking disabled");
  return null;
}

function splitAudioFile(
  inputPath: string,
  tmpDir: string,
  ffmpegPath: string
): string[] {
  const { execSync } = require("child_process");

  // Get duration
  let durationOutput: string;
  try {
    durationOutput = execSync(
      `"${ffmpegPath}" -i "${inputPath}" 2>&1 || true`,
      { encoding: "utf-8" }
    );
  } catch (e) {
    durationOutput = String(e);
  }

  const durationMatch = durationOutput.match(
    /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/
  );
  if (!durationMatch) {
    console.warn("[transcribe] Cannot determine audio duration, skipping split");
    return [inputPath];
  }

  const totalSeconds =
    parseInt(durationMatch[1]) * 3600 +
    parseInt(durationMatch[2]) * 60 +
    parseInt(durationMatch[3]);

  console.log(`[transcribe] Audio duration: ${totalSeconds}s`);

  if (totalSeconds <= CHUNK_DURATION_SECONDS) {
    return [inputPath];
  }

  const numChunks = Math.ceil(totalSeconds / CHUNK_DURATION_SECONDS);
  console.log(`[transcribe] Splitting into ${numChunks} chunks`);
  const chunks: string[] = [];

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION_SECONDS;
    const chunkPath = path.join(tmpDir, `chunk_${i}.mp3`);

    execSync(
      `"${ffmpegPath}" -i "${inputPath}" -ss ${startTime} -t ${CHUNK_DURATION_SECONDS} -acodec libmp3lame -ar 16000 -ac 1 -y "${chunkPath}"`,
      { stdio: "pipe" }
    );

    chunks.push(chunkPath);
  }

  return chunks;
}

async function transcribeChunk(
  openai: OpenAI,
  filePath: string,
  timeOffset: number
): Promise<{ text: string; segments: WhisperSegment[] }> {
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  const file = new File([fileBuffer], fileName, { type: "audio/mpeg" });

  console.log(`[transcribe] Sending chunk to Whisper: ${fileName} (${fileBuffer.length} bytes)`);

  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    language: "he",
  });

  const segments: WhisperSegment[] = (
    (response as unknown as { segments?: WhisperSegment[] }).segments || []
  ).map((seg) => ({
    ...seg,
    start: seg.start + timeOffset,
    end: seg.end + timeOffset,
  }));

  return {
    text: response.text,
    segments,
  };
}

export async function POST(request: NextRequest) {
  // Validate env vars before doing anything
  const envError = validateEnvVars("OPENAI_API_KEY");
  if (envError) return envError;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-"));

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return jsonResponse({ error: "לא נבחר קובץ אודיו" }, 400);
    }

    console.log(`[transcribe] Processing audio: ${file.name} (${file.size} bytes)`);

    // Save uploaded file to temp directory
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const inputPath = path.join(tmpDir, safeName);
    fs.writeFileSync(inputPath, buffer);

    let chunkPaths: string[];

    if (buffer.length > WHISPER_MAX_SIZE) {
      console.log(`[transcribe] File exceeds 25MB (${(buffer.length / 1024 / 1024).toFixed(1)}MB), attempting split`);

      const ffmpegPath = getFfmpegPath();
      if (!ffmpegPath) {
        // No ffmpeg available — tell user to upload smaller files
        return jsonResponse(
          {
            error:
              "הקובץ גדול מ-25MB ולא ניתן לפצל אותו בסביבה הנוכחית. אנא העלו קובץ קטן יותר או פצלו את האודיו מראש.",
          },
          413
        );
      }

      chunkPaths = splitAudioFile(inputPath, tmpDir, ffmpegPath);
    } else {
      chunkPaths = [inputPath];
    }

    // Transcribe each chunk
    let fullText = "";
    const allSegments: WhisperSegment[] = [];

    for (let i = 0; i < chunkPaths.length; i++) {
      console.log(`[transcribe] Transcribing chunk ${i + 1}/${chunkPaths.length}`);
      const timeOffset = i * CHUNK_DURATION_SECONDS;
      const result = await transcribeChunk(openai, chunkPaths[i], timeOffset);
      fullText += (fullText ? " " : "") + result.text;
      allSegments.push(...result.segments);
    }

    console.log(`[transcribe] Complete — ${fullText.length} chars, ${allSegments.length} segments`);

    const result: TranscriptionResult = {
      text: fullText,
      segments: allSegments,
    };

    return jsonResponse(result);
  } catch (error) {
    return errorResponse("transcribe", error, "שגיאה בתמלול האודיו");
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export const maxDuration = 300; // Allow up to 5 minutes for long audio files
