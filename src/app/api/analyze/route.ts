import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

// ── Suspicion Engine prompt — scan PDF for anomalies ────────────────
const SYSTEM_PROMPT = `אתה מבקר תמלילים משפטיים בכיר עם 30 שנות ניסיון.

## תפקידך: סורק חשדות (Suspicion Engine)
אתה לא מתקן את הפרוטוקול. אתה סורק אותו ומסמן "אזורי חשד" שדורשים בדיקה אנושית.
ה-PDF הוא הבסיס. תמליל ה-Whisper (אם סופק) הוא כלי עזר שגיא בלבד.

## מה לסמן כחשוד:

### 🔴 חשד גבוה (high) — דורש בדיקה מיידית:

**ג'יבריש / מילים לא קיימות (gibberish):**
- מילים שאינן קיימות בעברית ואינן שם פרטי/מקצועי מוכר
- רצפי אותיות חסרי משמעות שנראים כמו הזיית מכונה
- מילים שנשמעות כמו עברית אבל אינן מילים אמיתיות
- דוגמאות: "דה משלמי", "מלולציה", "קסטרפי"
- riskReason: "gibberish"

**קריסת תחביר (Syntax Collapse):**
- משפטים שבורים דקדוקית — חסר נושא, חסר פועל, או מבנה לא הגיוני
- משפט שמתחיל באמצע רעיון (סימן להשמטת תוכן)
- שני משפטים שמתמזגים ללא הגיון
- riskReason: "syntaxCollapse"

**עייפות דובר — פסקה מעל 400 תווים ללא החלפת דובר (Speaker Fatigue):**
- כל בלוק טקסט ארוך מ-400 תווים ללא שינוי דובר
- חשוד מאוד להחלפת דובר שלא תועדה
- בפרוטוקול משפטי, דובר אחד לעתים רחוקות מדבר ברצף כזה
- riskReason: "speakerFatigue"

**חשודים פונטיים (Phonetic Suspects):**
- החלפת "לא" ו"לו" (משנה משמעות לחלוטין)
- מספרים שנראים לא הגיוניים בהקשר (1000 במקום 100, 15 במקום 50)
- שמות שנראים מעוותים או שונים מהופעות קודמות באותו מסמך
- riskReason: "phoneticSuspect"

**שיוך דובר חשוד:**
- משפט שלא הגיוני שהשופט/העד/עורך הדין אמר אותו
- מעבר פתאומי בסגנון הדיבור באמצע קטע של אותו דובר
- riskReason: "speakerMismatch"

**היפוכי שלילה:**
- "הוא כן הגיע" לעומת "הוא לא הגיע" — בדוק אם ה"לא" נבלע
- תשובות קצרות ("כן", "לא") שאולי הופכו
- riskReason: "negationFlip"

### 🟡 חשד בינוני (medium):

**"החלקת" עדות (Smoothing):**
- משפט שוטף ומנוסח היטב שנראה "טוב מדי" לעדות חיה
- חשד שהיסוסים, גמגומים, או חזרות הוסרו
- riskReason: "smoothing"

**פערים סמנטיים:**
- משפטים שלא עוקבים הגיונית אחד אחרי השני
- שאלה שהתשובה עליה לא מתאימה
- קטע שנראה כאילו חסר בו משהו
- riskReason: "semanticGap"

### 🟢 חשד נמוך (low):
- ניסוח לא טבעי שעשוי להיות סגנון הדובר
- מונח מקצועי נדיר שכדאי לוודא
- riskReason: "stylistic"

## מה לא לסמן:
- ❌ הבדלי פיסוק ורווחים
- ❌ עיצוב וכותרות
- ❌ הבדלים שנובעים רק מטעות Whisper

## מילון מוגן — אל תסמן כחשודים:
זמישלני, פרופסיה, סומטית, לונגיטודינליות, אנמנזה, פתולוגיה,
אטיולוגיה, קוגניטיבי, רטרואקטיבי, אמבולטורי, דיפרנציאלית,
אפידמיולוגי, פרוגנוזה

## פורמט
החזר JSON בלבד:
{"discrepancies": [{
  "timestamp": "MM:SS",
  "originalText": "הטקסט החשוד מה-PDF",
  "correctedText": "",
  "significance": "קריטי/בינוני/נמוך",
  "explanation": "למה זה חשוד ומה לבדוק",
  "riskScore": "high/medium/low",
  "riskReason": "סוג החשד"
}]}

שדה correctedText נשאר ריק — המתמלל האנושי ימלא אותו.
אם לא נמצאו אזורים חשודים: {"discrepancies": []}`;

// ── Chunking ───────────────────────────────────────────────────────
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

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

async function scanChunk(
  openai: OpenAI,
  pdfChunk: string,
  whisperChunk: string | null,
  chunkIndex: number,
  totalChunks: number
): Promise<Discrepancy[]> {
  const userParts = [`## קטע ${chunkIndex + 1} מתוך ${totalChunks}\n\n### טקסט הפרוטוקול (PDF):\n${pdfChunk}`];

  if (whisperChunk) {
    userParts.push(`\n\n### תמליל Whisper (כלי עזר בלבד — שגיא):\n${whisperChunk}`);
  }

  userParts.push("\n\nסרוק את טקסט ה-PDF. סמן אזורים חשודים שדורשים בדיקה אנושית.");

  const userMessage = userParts.join("");

  console.log(`[analyze] Scanning chunk ${chunkIndex + 1}/${totalChunks} (${pdfChunk.length} chars)`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.05,
    response_format: { type: "json_object" },
    max_tokens: 4000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.discrepancies)
        ? parsed.discrepancies
        : [];

    const results = items.map(
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
      })
    );

    console.log(`[analyze] Chunk ${chunkIndex + 1}: ${results.length} suspicious zones found`);
    return results;
  } catch (parseError) {
    console.error("[analyze] Parse error:", parseError);
    return [];
  }
}

// ── Main handler ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars("OPENAI_API_KEY");
    if (envError) return envError;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const body = await request.json();
    const { pdfText, whisperText } = body;

    if (!pdfText) {
      return jsonResponse({ error: "חסר טקסט PDF" }, 400);
    }

    console.log(`[analyze] === SUSPICION SCAN ===`);
    console.log(`[analyze] PDF: ${pdfText.length} chars`);
    if (whisperText) console.log(`[analyze] Whisper: ${whisperText.length} chars (advisory only)`);

    const pdfChunks = chunkText(pdfText, MAX_CHUNK_CHARS);
    const whisperChunks = whisperText ? chunkText(whisperText, MAX_CHUNK_CHARS) : null;

    console.log(`[analyze] ${pdfChunks.length} PDF chunks`);

    const allFlags: Discrepancy[] = [];

    for (let i = 0; i < pdfChunks.length; i++) {
      const whisperChunk = whisperChunks
        ? whisperChunks[Math.min(i, whisperChunks.length - 1)]
        : null;

      const flags = await scanChunk(openai, pdfChunks[i], whisperChunk, i, pdfChunks.length);
      allFlags.push(...flags);
    }

    // Sort by timestamp
    allFlags.sort((a, b) => {
      const toSec = (t: string) => {
        const p = t.split(":").map(Number);
        return (p[0] || 0) * 60 + (p[1] || 0);
      };
      return toSec(a.timestamp) - toSec(b.timestamp);
    });

    const high = allFlags.filter((d) => d.riskScore === "high").length;
    const medium = allFlags.filter((d) => d.riskScore === "medium").length;

    console.log(`[analyze] === SCAN COMPLETE: ${allFlags.length} zones (${high} high, ${medium} medium) ===`);

    return jsonResponse({
      discrepancies: allFlags,
      totalFound: allFlags.length,
      chunksAnalyzed: pdfChunks.length,
      summary: { high, medium, low: allFlags.length - high - medium },
    });
  } catch (error) {
    return errorResponse("analyze", error, "שגיאה בסריקת הפרוטוקול");
  }
}
