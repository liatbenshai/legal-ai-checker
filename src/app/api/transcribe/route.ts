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
 * Resolve ffmpeg binary path.
 */
function getFfmpegPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require("ffmpeg-static") as string;
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // not available
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require("child_process");
    const systemPath = execSync(
      "which ffmpeg 2>/dev/null || where ffmpeg 2>nul",
      { encoding: "utf-8" }
    ).trim();
    if (systemPath) return systemPath;
  } catch {
    // not found
  }

  return null;
}

function splitAudioFile(
  inputPath: string,
  tmpDir: string,
  ffmpegPath: string
): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require("child_process");

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
  if (!durationMatch) return [inputPath];

  const totalSeconds =
    parseInt(durationMatch[1]) * 3600 +
    parseInt(durationMatch[2]) * 60 +
    parseInt(durationMatch[3]);

  console.log(`[transcribe] Audio duration: ${totalSeconds}s`);

  if (totalSeconds <= CHUNK_DURATION_SECONDS) return [inputPath];

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

  console.log(
    `[transcribe] Sending to Whisper: ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`
  );

  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    language: "he",
    prompt:
      "זהו פרוטוקול דיון בבית משפט בישראל. " +
      "דוברים: שופט, עורך דין, עד, נאשם, תובע. " +
      "מונחים משפטיים: פרוטוקול, עדות, חקירה נגדית, חקירה ראשית, סיכומים, " +
      "כתב אישום, כתב הגנה, תצהיר, בקשה, החלטה, פסק דין, ערעור, " +
      "סעיף, חוק, תקנה, פקודה, בית המשפט העליון, בית המשפט המחוזי, " +
      "בית משפט השלום, רשם, מזכירות, הוצאה לפועל. " +
      "שמות נפוצים: כהן, לוי, ישראלי, מזרחי, פרידמן, גולדשטיין.",
  });

  const segments: WhisperSegment[] = (
    (response as unknown as { segments?: WhisperSegment[] }).segments || []
  ).map((seg) => ({
    ...seg,
    start: seg.start + timeOffset,
    end: seg.end + timeOffset,
  }));

  return { text: response.text, segments };
}

export async function POST(request: NextRequest) {
  const envError = validateEnvVars("OPENAI_API_KEY");
  if (envError) return envError;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-"));

  try {
    const body = await request.json();
    const { audioUrl, fileName } = body as {
      audioUrl: string;
      fileName: string;
    };

    if (!audioUrl) {
      return jsonResponse({ error: "חסר קישור לקובץ אודיו" }, 400);
    }

    console.log(`[transcribe] Downloading audio from storage: ${fileName}`);

    // Download the file from Supabase Storage signed URL
    const downloadRes = await fetch(audioUrl);
    if (!downloadRes.ok) {
      console.error(
        `[transcribe] Download failed: ${downloadRes.status} ${downloadRes.statusText}`
      );
      return jsonResponse({ error: "שגיאה בהורדת קובץ האודיו מהשרת" }, 500);
    }

    const audioBuffer = Buffer.from(await downloadRes.arrayBuffer());
    console.log(
      `[transcribe] Downloaded ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB`
    );

    const safeName = (fileName || "audio.mp3").replace(/[^a-zA-Z0-9._-]/g, "_");
    const inputPath = path.join(tmpDir, safeName);
    fs.writeFileSync(inputPath, audioBuffer);

    // Determine if we need to split
    let chunkPaths: string[];

    if (audioBuffer.length > WHISPER_MAX_SIZE) {
      console.log(
        `[transcribe] File exceeds 25MB, attempting ffmpeg split`
      );
      const ffmpegPath = getFfmpegPath();
      if (!ffmpegPath) {
        return jsonResponse(
          {
            error:
              "הקובץ גדול מ-25MB ולא ניתן לפצל אותו בסביבה הנוכחית. אנא פצלו את האודיו מראש לקטעים של עד 25MB.",
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
      console.log(
        `[transcribe] Transcribing chunk ${i + 1}/${chunkPaths.length}`
      );
      const timeOffset = i * CHUNK_DURATION_SECONDS;
      const result = await transcribeChunk(openai, chunkPaths[i], timeOffset);
      fullText += (fullText ? " " : "") + result.text;
      allSegments.push(...result.segments);
    }

    console.log(
      `[transcribe] Complete — ${fullText.length} chars, ${allSegments.length} segments`
    );

    const result: TranscriptionResult = {
      text: fullText,
      segments: allSegments,
    };

    return jsonResponse(result);
  } catch (error) {
    return errorResponse("transcribe", error, "שגיאה בתמלול האודיו");
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export const maxDuration = 300;
