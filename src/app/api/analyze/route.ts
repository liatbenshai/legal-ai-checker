import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export const maxDuration = 60; // Vercel Hobby max

// ── Compact prompt ──────────────────────────────────────────────────
const SYSTEM_PROMPT = `סרוק פרוטוקול משפטי בעברית וסמן אזורים חשודים. אל תתקן — רק סמן.

🔴 high:
- מילים לא קיימות בעברית (gibberish)
- משפטים שבורים דקדוקית (syntaxCollapse)
- בלוק מעל 400 תווים ללא החלפת דובר (speakerFatigue)
- משפט עם לא/אין/כן/נכון/מעולם (negationFlag)
- שיוך דובר חשוד (speakerOverlap)
- שם פרטי/משפחה או מספר/תאריך/סכום (properNameWatch)
- סיומות מורפולוגיות שגויות ת/תי/ה (morphologicalMismatch)
- מילה יומיומית במקום מונח משפטי (legalHallucination)

🟡 medium:
- משפט שוטף מדי — חשד להחלקה (smoothing)
- שאלה ותשובה שלא מתחברות (semanticGap)

🟢 low: ניסוח לא טבעי (stylistic)

אל תסמן: רווחים, פיסוק, עיצוב.
מילון מוגן: זמישלני, פרופסיה, סומטית, לונגיטודינליות, שיבוב, הרשעה, זיכוי

פורמט JSON בלבד:
{"discrepancies":[{"timestamp":"MM:SS","originalText":"טקסט","correctedText":"","significance":"קריטי/בינוני/נמוך","explanation":"הסבר","riskScore":"high/medium/low","riskReason":"דפוס","pageRef":""}]}
אם אין: {"discrepancies":[]}`;

const MAX_CHUNK_CHARS = 1200;
const TIME_BUDGET_MS = 50000; // stop processing at 50s to leave 10s for response

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

function parseResponse(content: string, chunkIdx: number): Discrepancy[] {
  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : parsed.discrepancies || [];
    return items.map(
      (item: Record<string, string>): Discrepancy => ({
        timestamp: item.timestamp || "00:00",
        originalText: item.originalText || "",
        correctedText: item.correctedText || "",
        significance: (item.significance as Discrepancy["significance"]) || "נמוך",
        explanation: item.explanation || "",
        riskScore: (item.riskScore as Discrepancy["riskScore"]) || "low",
        riskReason: item.riskReason || "",
        humanVerified: false,
        auditorNotes: "",
        pageRef: item.pageRef || "",
      })
    );
  } catch (err) {
    console.error(
      `[analyze] ❌ JSON parse failed chunk ${chunkIdx + 1}:`,
      `"${content?.substring(0, 300)}"`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const envError = validateEnvVars("OPENAI_API_KEY");
    if (envError) return envError;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 25000, // 25s max per GPT call
    });

    const body = await request.json();
    const { pdfText, whisperText } = body;

    if (!pdfText) return jsonResponse({ error: "חסר טקסט PDF" }, 400);

    const pdfChunks = chunkText(pdfText, MAX_CHUNK_CHARS);
    const whisperChunks = whisperText ? chunkText(whisperText, MAX_CHUNK_CHARS) : null;
    const totalChunks = pdfChunks.length;

    console.log(`[analyze] === START === ${pdfText.length} chars → ${totalChunks} chunks`);

    const allFlags: Discrepancy[] = [];
    let processed = 0;
    let failed = 0;

    for (let i = 0; i < totalChunks; i++) {
      // ── Time budget guard ──
      const elapsed = Date.now() - startTime;
      if (elapsed > TIME_BUDGET_MS) {
        console.warn(
          `[analyze] ⏰ Time budget exhausted at ${(elapsed / 1000).toFixed(1)}s — ` +
          `processed ${processed}/${totalChunks} chunks, returning partial results`
        );
        break;
      }

      console.log(`[analyze] 📄 Starting chunk ${i + 1}/${totalChunks} (${pdfChunks[i].length} chars, ${(elapsed / 1000).toFixed(1)}s elapsed)`);

      const wc = whisperChunks ? whisperChunks[Math.min(i, whisperChunks.length - 1)] : null;
      const userMsg = wc
        ? `קטע ${i + 1}/${totalChunks}:\n${pdfChunks[i]}\n\nרמז Whisper:\n${wc}`
        : `קטע ${i + 1}/${totalChunks}:\n${pdfChunks[i]}`;

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMsg },
          ],
          temperature: 0.05,
          response_format: { type: "json_object" },
          max_tokens: 1500,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          console.warn(`[analyze] ⚠️ Empty response chunk ${i + 1}`);
          failed++;
        } else {
          const flags = parseResponse(content, i);
          console.log(`[analyze] ✅ Finished chunk ${i + 1}/${totalChunks} — Found ${flags.length} anomalies`);
          allFlags.push(...flags);
        }
      } catch (chunkErr) {
        const msg = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
        console.error(`[analyze] ❌ Chunk ${i + 1}/${totalChunks} FAILED: ${msg}`);
        failed++;

        if (msg.includes("429") || msg.includes("rate_limit")) {
          console.log(`[analyze] ⏳ Rate limited — waiting 3s...`);
          await new Promise((r) => setTimeout(r, 3000));
        }
        // Continue to next chunk
      }

      processed++;
    }

    // Sort by timestamp
    allFlags.sort((a, b) => {
      const s = (t: string) => { const p = t.split(":").map(Number); return (p[0]||0)*60+(p[1]||0); };
      return s(a.timestamp) - s(b.timestamp);
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[analyze] === DONE in ${elapsed}s === ` +
      `${allFlags.length} zones, ${processed}/${totalChunks} chunks, ${failed} failed`
    );

    return jsonResponse({
      discrepancies: allFlags,
      totalFound: allFlags.length,
      chunksAnalyzed: processed,
      totalChunks,
      failedChunks: failed,
      partialResults: processed < totalChunks,
    });
  } catch (error) {
    return errorResponse("analyze", error, "שגיאה בסריקת הפרוטוקול");
  }
}
