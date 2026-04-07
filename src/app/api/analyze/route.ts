import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

// ── Compact auditor prompt (trimmed for reliability) ────────────────
const SYSTEM_PROMPT = `אתה סורק חשדות בפרוטוקולים משפטיים בעברית.
סרוק את הטקסט וסמן אזורים חשודים. אל תתקן — רק סמן.

## סמן כחשוד:
🔴 high:
- מילים לא קיימות בעברית (gibberish)
- משפטים שבורים דקדוקית (syntaxCollapse)
- בלוק מעל 400 תווים ללא החלפת דובר (speakerFatigue)
- כל משפט עם לא/אין/כן/נכון/מעולם — בדיקת שלילה חובה (negationFlag)
- שיוך דובר חשוד — סגנון לא מתאים לדובר (speakerOverlap)
- כל שם פרטי/משפחה וכל מספר/תאריך/סכום (properNameWatch)
- סיומות מורפולוגיות שגויות: ת/תי/ה לא מתאימות (morphologicalMismatch)
- מילה יומיומית במקום מונח משפטי: סיבוב≠שיבוב, הרגשה≠הרשעה (legalHallucination)

🟡 medium:
- משפט שוטף מדי — חשד להחלקת היסוסים (smoothing)
- שאלה ותשובה שלא מתחברות (semanticGap)

🟢 low:
- ניסוח לא טבעי (stylistic)

## אל תסמן: רווחים, פיסוק, עיצוב, שגיאות Whisper בלבד.
## מילון מוגן: זמישלני, פרופסיה, סומטית, לונגיטודינליות, אנמנזה, פתולוגיה, קוגניטיבי, שיבוב, הרשעה, זיכוי

## פורמט — JSON בלבד:
{"discrepancies":[{"timestamp":"MM:SS","originalText":"טקסט חשוד","correctedText":"","significance":"קריטי/בינוני/נמוך","explanation":"למה חשוד","riskScore":"high/medium/low","riskReason":"שם הדפוס","pageRef":""}]}
אם אין: {"discrepancies":[]}`;

const MAX_CHUNK_CHARS = 1000;

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const lines = text.split(/\n/);
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

function parseDiscrepancies(
  content: string,
  whisperChunk: string | null,
  chunkIndex: number
): Discrepancy[] {
  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : parsed.discrepancies || [];

    return items.map(
      (item: Record<string, string>): Discrepancy => ({
        timestamp: item.timestamp || "00:00",
        originalText: item.originalText || "",
        correctedText: item.correctedText || "",
        significance:
          (item.significance as Discrepancy["significance"]) || "נמוך",
        explanation: item.explanation || "",
        riskScore: (item.riskScore as Discrepancy["riskScore"]) || "low",
        riskReason: item.riskReason || "",
        humanVerified: false,
        auditorNotes: "",
        whisperHint: whisperChunk || undefined,
        pageRef: item.pageRef || "",
      })
    );
  } catch (parseErr) {
    // Log the raw content that failed to parse
    console.error(
      `[analyze] ❌ JSON parse failed for chunk ${chunkIndex + 1}.`,
      `Raw content (first 500 chars): "${content?.substring(0, 500)}"`,
      `Error: ${parseErr instanceof Error ? parseErr.message : parseErr}`
    );
    return [];
  }
}

async function scanChunk(
  openai: OpenAI,
  pdfChunk: string,
  whisperChunk: string | null,
  chunkIndex: number,
  totalChunks: number
): Promise<Discrepancy[]> {
  console.log(
    `[analyze] 📄 Analyzing chunk ${chunkIndex + 1} of ${totalChunks}... (${pdfChunk.length} chars)`
  );

  const userParts = [
    `קטע ${chunkIndex + 1}/${totalChunks}:\n${pdfChunk}`,
  ];
  if (whisperChunk) {
    userParts.push(`\nרמז Whisper:\n${whisperChunk}`);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userParts.join("") },
      ],
      temperature: 0.05,
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      console.warn(`[analyze] ⚠️ Empty response for chunk ${chunkIndex + 1}`);
      return [];
    }

    console.log(
      `[analyze] ✅ Chunk ${chunkIndex + 1} response received (${content.length} chars)`
    );

    const results = parseDiscrepancies(content, whisperChunk, chunkIndex);
    console.log(
      `[analyze] Chunk ${chunkIndex + 1}: ${results.length} suspicious zones`
    );

    return results;
  } catch (chunkErr) {
    // Per-chunk error — log and skip, don't crash the whole analysis
    const errMsg =
      chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
    console.error(
      `[analyze] ❌ Chunk ${chunkIndex + 1}/${totalChunks} FAILED: ${errMsg}`
    );

    // Check if it's a rate limit or timeout
    if (errMsg.includes("rate_limit") || errMsg.includes("429")) {
      console.log(`[analyze] ⏳ Rate limited — waiting 5s before continuing...`);
      await new Promise((r) => setTimeout(r, 5000));
    }

    // Return empty array for this chunk — analysis continues
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars("OPENAI_API_KEY");
    if (envError) return envError;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000, // 30s per GPT call — leave room for multiple chunks within 60s
    });

    const body = await request.json();
    const { pdfText, whisperText } = body;

    if (!pdfText) return jsonResponse({ error: "חסר טקסט PDF" }, 400);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[analyze] === DEEP ANOMALY SCAN START ===`);
    console.log(`[analyze] PDF text: ${pdfText.length} chars`);
    if (whisperText)
      console.log(`[analyze] Whisper text: ${whisperText.length} chars`);

    const pdfChunks = chunkText(pdfText, MAX_CHUNK_CHARS);
    const whisperChunks = whisperText
      ? chunkText(whisperText, MAX_CHUNK_CHARS)
      : null;

    console.log(`[analyze] Split into ${pdfChunks.length} chunks of ≤${MAX_CHUNK_CHARS} chars`);
    console.log(`${"=".repeat(60)}\n`);

    const allFlags: Discrepancy[] = [];
    let failedChunks = 0;

    for (let i = 0; i < pdfChunks.length; i++) {
      const wc = whisperChunks
        ? whisperChunks[Math.min(i, whisperChunks.length - 1)]
        : null;

      const flags = await scanChunk(openai, pdfChunks[i], wc, i, pdfChunks.length);

      if (flags.length === 0 && pdfChunks[i].length > 100) {
        // Chunk had substantial text but returned nothing — might have failed
        failedChunks++;
      }

      allFlags.push(...flags);
    }

    // Sort by timestamp
    allFlags.sort((a, b) => {
      const s = (t: string) => {
        const p = t.split(":").map(Number);
        return (p[0] || 0) * 60 + (p[1] || 0);
      };
      return s(a.timestamp) - s(b.timestamp);
    });

    const high = allFlags.filter((d) => d.riskScore === "high").length;
    const med = allFlags.filter((d) => d.riskScore === "medium").length;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[analyze] === SCAN COMPLETE ===`);
    console.log(`[analyze] Total zones: ${allFlags.length} (${high} high, ${med} medium)`);
    console.log(`[analyze] Chunks processed: ${pdfChunks.length} (${failedChunks} returned empty)`);
    console.log(`${"=".repeat(60)}\n`);

    return jsonResponse({
      discrepancies: allFlags,
      totalFound: allFlags.length,
      chunksAnalyzed: pdfChunks.length,
      failedChunks,
    });
  } catch (error) {
    return errorResponse("analyze", error, "שגיאה בסריקת הפרוטוקול");
  }
}

export const maxDuration = 60; // Vercel Hobby max = 60 seconds
