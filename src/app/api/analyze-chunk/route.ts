import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export const maxDuration = 30; // single chunk = fast

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

JSON בלבד:
{"discrepancies":[{"timestamp":"MM:SS","originalText":"טקסט","correctedText":"","significance":"קריטי/בינוני/נמוך","explanation":"הסבר","riskScore":"high/medium/low","riskReason":"דפוס","pageRef":""}]}
אם אין: {"discrepancies":[]}`;

export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars("OPENAI_API_KEY");
    if (envError) return envError;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 25000,
    });

    const body = await request.json();
    const { pdfChunk, whisperChunk, chunkIndex, totalChunks } = body as {
      pdfChunk: string;
      whisperChunk?: string;
      chunkIndex: number;
      totalChunks: number;
    };

    if (!pdfChunk) return jsonResponse({ error: "חסר טקסט" }, 400);

    console.log(`[chunk] 📄 Chunk ${chunkIndex + 1}/${totalChunks} (${pdfChunk.length} chars)`);

    const userMsg = whisperChunk
      ? `קטע ${chunkIndex + 1}/${totalChunks}:\n${pdfChunk}\n\nרמז Whisper:\n${whisperChunk}`
      : `קטע ${chunkIndex + 1}/${totalChunks}:\n${pdfChunk}`;

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
      console.warn(`[chunk] ⚠️ Empty response chunk ${chunkIndex + 1}`);
      return jsonResponse({ discrepancies: [], chunkIndex });
    }

    let items: Discrepancy[] = [];
    try {
      const parsed = JSON.parse(content);
      const raw = Array.isArray(parsed) ? parsed : parsed.discrepancies || [];
      items = raw.map(
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
    } catch (parseErr) {
      console.error(`[chunk] ❌ Parse failed chunk ${chunkIndex + 1}:`, content?.substring(0, 300));
      return jsonResponse({ discrepancies: [], chunkIndex, parseError: true });
    }

    console.log(`[chunk] ✅ Chunk ${chunkIndex + 1} — ${items.length} zones`);
    return jsonResponse({ discrepancies: items, chunkIndex });
  } catch (error) {
    return errorResponse("analyze-chunk", error, "שגיאה בסריקת קטע");
  }
}
