import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

// ── Deep Legal Anomaly Auditor ──────────────────────────────────────
const SYSTEM_PROMPT = `אתה מבקר תמלילים משפטיים בכיר עם 30 שנות ניסיון בפרוטוקולים של בתי משפט בישראל.

## תפקידך
סרוק את טקסט הפרוטוקול (PDF) ואתר "אזורי חשד" המבוססים על דפוסי כשל ידועים של מערכות תמלול אוטומטיות בעברית.
אתה לא מתקן. אתה מסמן. האדם יבדוק ויתקן.
ה-Whisper (אם סופק) הוא כלי עזר שגיא בלבד — רמז, לא אמת.

## דפוסי כשל עמוקים בעברית (Deep Hebrew Failure Patterns)

### 🔴 חשד גבוה (high) — CRITICAL:

**1. אי-התאמה מורפולוגית (morphologicalMismatch):**
- סיומות מבולבלות: ת/תי/ה שלא מתאימות להקשר (גוף, מגדר, זמן)
- "אמרת" במקום "אמרתי", "עשתה" במקום "עשה"
- שינוי גוף שמשנה את זהות הדובר/מושא

**2. הזיות משפטיות (legalHallucination):**
- מילים עבריות תקינות שלא שייכות להקשר משפטי
- "סיבוב" במקום "שיבוב", "הרגשה" במקום "הרשעה"
- מונח שנשמע דומה למונח משפטי אבל הוא מילה יומיומית

**3. היפוך שלילה/אישור — חובת סימון מוחלטת (negationFlag):**
- סמן כל משפט המכיל: לא, אין, מעולם, חלילה, אף פעם, שום
- סמן כל משפט המכיל: כן, נכון, אמת, בהחלט, אכן
- אלו הם האזורים הקריטיים ביותר — שגיאה כאן הופכת עדות

**4. חפיפת דוברים / קיפול הפסקה (speakerOverlap):**
- אזור שבו נראה שדוברים מדברים בו-זמנית
- קטע PDF שקיפל הפרעה/קריאת ביניים לתוך דברי דובר אחד
- שינוי פתאומי בסגנון באמצע פסקת דובר

**5. עייפות דובר — בלוק מעל 400 תווים (speakerFatigue):**
- כל בלוק טקסט מעל 400 תווים ללא החלפת דובר
- חשוד מאוד — בפרוטוקול משפטי יש תמיד דו-שיח

**6. שמירת שמות ומספרים — סימון חובה (properNameWatch):**
- סמן כל שם פרטי/משפחה שמופיע בטקסט
- סמן כל מספר: תאריכים, סכומים, כתובות, מספרי תיק
- שמות ומספרים הם נקודות הכשל השכיחות ביותר

**7. ג'יבריש וקריסת תחביר (gibberish / syntaxCollapse):**
- מילים לא קיימות בעברית
- משפטים שבורים: חסר נושא, חסר פועל
- שני משפטים ממוזגים ללא הגיון

### 🟡 חשד בינוני (medium):

**8. מלכודת ההחלקה (smoothing):**
- משפט שוטף "מדי" לעדות חיה
- חשד שהיסוסים הוסרו (אבל לא ניתן לוודא ללא אודיו)
- תשובה שניתנה "מיד" ללא היסוס

**9. פערים סמנטיים (semanticGap):**
- שאלה ותשובה שלא מתחברות
- קטע שנראה כאילו חסרות בו מילים/משפטים
- מעבר לא הגיוני בין נושאים

### 🟢 חשד נמוך (low):
- ניסוח לא טבעי
- מונח מקצועי נדיר (stylistic)

## מה לא לסמן:
- ❌ רווחים, פיסוק, עיצוב
- ❌ שגיאות שנובעות רק מ-Whisper

## מילון מוגן:
זמישלני, פרופסיה, סומטית, לונגיטודינליות, אנמנזה, פתולוגיה,
אטיולוגיה, קוגניטיבי, רטרואקטיבי, אמבולטורי, דיפרנציאלית,
אפידמיולוגי, פרוגנוזה, שיבוב, הרשעה, זיכוי, ערבות, משכנתא

## פורמט
{"discrepancies": [{
  "timestamp": "MM:SS",
  "originalText": "הטקסט החשוד מה-PDF",
  "correctedText": "",
  "significance": "קריטי/בינוני/נמוך",
  "explanation": "למה חשוד + מה לבדוק",
  "riskScore": "high/medium/low",
  "riskReason": "morphologicalMismatch/legalHallucination/negationFlag/speakerOverlap/speakerFatigue/properNameWatch/gibberish/syntaxCollapse/smoothing/semanticGap/stylistic",
  "pageRef": "עמוד/שורה אם ניתן לזהות"
}]}

correctedText נשאר ריק — האדם ימלא.
אם אין חשדות: {"discrepancies": []}`;

const MAX_CHUNK_CHARS = 2000;

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

async function scanChunk(
  openai: OpenAI,
  pdfChunk: string,
  whisperChunk: string | null,
  chunkIndex: number,
  totalChunks: number
): Promise<Discrepancy[]> {
  const parts = [`## קטע ${chunkIndex + 1} מתוך ${totalChunks}\n\n### פרוטוקול (PDF):\n${pdfChunk}`];
  if (whisperChunk) {
    parts.push(`\n\n### רמז Whisper (שגיא — כלי עזר בלבד):\n${whisperChunk}`);
  }
  parts.push("\n\nסרוק לפי דפוסי הכשל. סמן כל אזור חשוד.");

  console.log(`[analyze] Scanning chunk ${chunkIndex + 1}/${totalChunks} (${pdfChunk.length} chars)`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: parts.join("") },
    ],
    temperature: 0.05,
    response_format: { type: "json_object" },
    max_tokens: 4000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

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
        whisperHint: whisperChunk ? "" : undefined,
        pageRef: item.pageRef || "",
      })
    );
  } catch {
    console.error("[analyze] Parse error for chunk", chunkIndex + 1);
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars("OPENAI_API_KEY");
    if (envError) return envError;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const body = await request.json();
    const { pdfText, whisperText } = body;

    if (!pdfText) return jsonResponse({ error: "חסר טקסט PDF" }, 400);

    console.log(`[analyze] === DEEP ANOMALY SCAN === PDF: ${pdfText.length} chars`);

    const pdfChunks = chunkText(pdfText, MAX_CHUNK_CHARS);
    const whisperChunks = whisperText ? chunkText(whisperText, MAX_CHUNK_CHARS) : null;

    const allFlags: Discrepancy[] = [];
    for (let i = 0; i < pdfChunks.length; i++) {
      const wc = whisperChunks ? whisperChunks[Math.min(i, whisperChunks.length - 1)] : null;
      const flags = await scanChunk(openai, pdfChunks[i], wc, i, pdfChunks.length);
      allFlags.push(...flags);
    }

    allFlags.sort((a, b) => {
      const s = (t: string) => { const p = t.split(":").map(Number); return (p[0]||0)*60+(p[1]||0); };
      return s(a.timestamp) - s(b.timestamp);
    });

    const high = allFlags.filter((d) => d.riskScore === "high").length;
    const med = allFlags.filter((d) => d.riskScore === "medium").length;
    console.log(`[analyze] === DONE: ${allFlags.length} zones (${high} high, ${med} medium) ===`);

    return jsonResponse({ discrepancies: allFlags, totalFound: allFlags.length, chunksAnalyzed: pdfChunks.length });
  } catch (error) {
    return errorResponse("analyze", error, "שגיאה בסריקת הפרוטוקול");
  }
}
