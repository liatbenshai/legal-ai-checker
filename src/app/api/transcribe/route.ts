import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type { WhisperSegment, TranscriptionResult } from "@/lib/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25MB
const CHUNK_DURATION_SECONDS = 600; // 10 minutes per chunk

function getFfmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegStatic = require("ffmpeg-static") as string;
  return ffmpegStatic;
}

function splitAudioFile(inputPath: string, tmpDir: string): string[] {
  const ffmpeg = getFfmpegPath();
  const chunks: string[] = [];

  // Get duration
  const durationOutput = execSync(
    `"${ffmpeg}" -i "${inputPath}" 2>&1 || true`,
    { encoding: "utf-8" }
  );

  const durationMatch = durationOutput.match(
    /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/
  );
  if (!durationMatch) {
    // Can't determine duration, return original file
    return [inputPath];
  }

  const totalSeconds =
    parseInt(durationMatch[1]) * 3600 +
    parseInt(durationMatch[2]) * 60 +
    parseInt(durationMatch[3]);

  if (totalSeconds <= CHUNK_DURATION_SECONDS) {
    return [inputPath];
  }

  const numChunks = Math.ceil(totalSeconds / CHUNK_DURATION_SECONDS);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION_SECONDS;
    const chunkPath = path.join(tmpDir, `chunk_${i}.mp3`);

    execSync(
      `"${ffmpeg}" -i "${inputPath}" -ss ${startTime} -t ${CHUNK_DURATION_SECONDS} -acodec libmp3lame -ar 16000 -ac 1 -y "${chunkPath}"`,
      { stdio: "pipe" }
    );

    chunks.push(chunkPath);
  }

  return chunks;
}

async function transcribeChunk(
  filePath: string,
  timeOffset: number
): Promise<{ text: string; segments: WhisperSegment[] }> {
  const fileStream = fs.createReadStream(filePath);
  const fileName = path.basename(filePath);

  const file = new File(
    [fs.readFileSync(filePath)],
    fileName,
    { type: "audio/mpeg" }
  );

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

  fileStream.destroy();

  return {
    text: response.text,
    segments,
  };
}

export async function POST(request: NextRequest) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-"));

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "לא נבחר קובץ אודיו" },
        { status: 400 }
      );
    }

    // Save uploaded file to temp directory
    const buffer = Buffer.from(await file.arrayBuffer());
    const inputPath = path.join(tmpDir, file.name);
    fs.writeFileSync(inputPath, buffer);

    let chunkPaths: string[];

    if (buffer.length > WHISPER_MAX_SIZE) {
      // Split into chunks using ffmpeg
      chunkPaths = splitAudioFile(inputPath, tmpDir);
    } else {
      chunkPaths = [inputPath];
    }

    // Transcribe each chunk
    let fullText = "";
    const allSegments: WhisperSegment[] = [];

    for (let i = 0; i < chunkPaths.length; i++) {
      const timeOffset = i * CHUNK_DURATION_SECONDS;
      const result = await transcribeChunk(chunkPaths[i], timeOffset);
      fullText += (fullText ? " " : "") + result.text;
      allSegments.push(...result.segments);
    }

    const result: TranscriptionResult = {
      text: fullText,
      segments: allSegments,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Transcription error:", error);
    const message =
      error instanceof Error ? error.message : "שגיאה בתמלול האודיו";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

// Next.js App Router handles large request bodies natively via FormData
export const maxDuration = 300; // Allow up to 5 minutes for long audio files
