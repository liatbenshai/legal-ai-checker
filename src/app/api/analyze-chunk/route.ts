import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export const maxDuration = 30;

const SYSTEM_PROMPT = `אתה סורק אנומליות אוניברסלי לפרוטוקולים משפטיים בעברית.
סרוק את הטקסט וסמן אזורים חשודים. אל תתקן — רק סמן. ה-PDF הוא הטקסט היחיד.

## דפוסים אוניברסליים לסימון:

🔴 high — חובת בדיקה:
1. **עוגני דוברים**: זהה שמות דוברים לפי תבנית ^[שם]: — סמן מעבר דובר חשוד או בלוק ארוך (>300 תווים) ללא החלפה (speakerFatigue)
2. **טריגר שלילה**: כל משפט עם לא/לו/אין/אף פעם/חלילה/מעולם/שום/כן/נכון/אמת/בהחלט — סימון חובה (negationFlag)
3. **שמירת ישויות**: כל שם פרטי/משפחה, מספר, תאריך, סכום כספי, כתובת, מספר תיק (entityWatch)
4. **סיכון מורפולוגי**: מילים בסיומות ת/תי/ה שלא מתאימות להקשר הדובר (morphologicalRisk)
5. **הזיות משפטיות**: מילה יומיומית שנשמעת כמו מונח משפטי: סיבוב≠שיבוב, הרגשה≠הרשעה (legalHallucination)
6. **ג'יבריש**: מילה שאינה קיימת בעברית ואינה שם מוגן (gibberish)
7. **קריסת תחביר**: משפט ללא נושא/פועל, שני משפטים ממוזגים (syntaxCollapse)

🟡 medium:
8. **החלקה אקוסטית**: משפט שוטף מדי — חשד שהיסוסים הוסרו (smoothing)
9. **פער סמנטי**: שאלה ותשובה שלא מתחברות, או מעבר נושא לא הגיוני (semanticGap)

🟢 low:
10. ניסוח לא טבעי (stylistic)

## אל תסמן: רווחים, פיסוק, עיצוב, כותרות.
## מילון מוגן: זמישלני, פרופסיה, סומטית, לונגיטודינליות, שיבוב, הרשעה, זיכוי, אנמנזה, פתולוגיה

## JSON בלבד:
{"discrepancies":[{"timestamp":"MM:SS","originalText":"הטקסט","correctedText":"","significance":"קריטי/בינוני/נמוך","explanation":"למה חשוד","riskScore":"high/medium/low","riskReason":"דפוס","pageRef":""}]}
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
    const { pdfChunk, chunkIndex, totalChunks, whisperTimestamps } = body as {
      pdfChunk: string;
      chunkIndex: number;
      totalChunks: number;
      whisperTimestamps?: string; // timestamps only, no text
    };

    if (!pdfChunk) return jsonResponse({ error: "חסר טקסט" }, 400);

    console.log(`[chunk] 📄 Chunk ${chunkIndex + 1}/${totalChunks} (${pdfChunk.length} chars)`);

    let userMsg = `קטע ${chunkIndex + 1}/${totalChunks}:\n${pdfChunk}`;
    if (whisperTimestamps) {
      userMsg += `\n\nעוגני זמן מהאודיו (לסנכרון בלבד):\n${whisperTimestamps}`;
    }

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
          correctedText: "",
          significance: (item.significance as Discrepancy["significance"]) || "נמוך",
          explanation: item.explanation || "",
          riskScore: (item.riskScore as Discrepancy["riskScore"]) || "low",
          riskReason: item.riskReason || "",
          humanVerified: false,
          auditorNotes: "",
          pageRef: item.pageRef || "",
        })
      );
    } catch {
      console.error(`[chunk] ❌ Parse failed chunk ${chunkIndex + 1}:`, content?.substring(0, 300));
      return jsonResponse({ discrepancies: [], chunkIndex, parseError: true });
    }

    console.log(`[chunk] ✅ Chunk ${chunkIndex + 1} — ${items.length} zones`);
    return jsonResponse({ discrepancies: items, chunkIndex });
  } catch (error) {
    return errorResponse("analyze-chunk", error, "שגיאה בסריקת קטע");
  }
}
