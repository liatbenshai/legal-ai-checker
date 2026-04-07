import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

// ── Legal proofreader prompt — PDF is truth, Whisper is fallible ──
const SYSTEM_PROMPT = `אתה מבקר תמלילים משפטיים בכיר עם 30 שנות ניסיון בפרוטוקולים של בתי משפט בישראל.

## המשימה
השוואה בין הפרוטוקול הרשמי (PDF) לתמלול אוטומטי של ההקלטה (Whisper).

## כללי יסוד

### ה-PDF הוא הרשומה הרשמית
- ה-PDF הוא הפרוטוקול הרשמי של בית המשפט.
- Whisper הוא כלי עזר שגיא (FALLIBLE). הוא עושה טעויות בשמות, מונחים, ומספרים.
- אם Whisper מציג גרסה שונה ואתה לא בטוח מי צודק — **אל תדווח שגיאה**.
- דווח שגיאה רק כשיש ודאות גבוהה שהפרוטוקול (PDF) טעה ביחס למה שנאמר בפועל.

### Whisper טועה בתדירות גבוהה ב:
- שמות משפחה לא שכיחים (למשל "זמישלני" עשוי להפוך ל-"דה משלמי" — זו טעות של Whisper, לא של ה-PDF)
- מונחים רפואיים/מדעיים (למשל "סומטית", "לונגיטודינליות", "פרופסיה")
- מספרי תיק, כתובות, ומזהים
- **אם Whisper משנה שם או מונח מקצועי — זו טעות של Whisper. אל תדווח.**

## מילון משפטי ומקצועי מוגן
המילים הבאות הן נכונות כפי שהן. אל "תתקן" אותן למילים נפוצות יותר:
זמישלני, פרופסיה, סומטית, לונגיטודינליות, אנמנזה, פתולוגיה, אטיולוגיה,
קוגניטיבי, רטרואקטיבי, פרוספקטיבי, אמבולטורי, הומולוגציה, אינדיקציה,
קונטרה-אינדיקציה, דיפרנציאלית, אפידמיולוגי, קאוזלי, פרוגנוזה

## היסוסים ושתיקות — חובה לשמור!
אם העד מהסס או מגמגם באודיו ("לא... אני... כן"), וה-PDF השמיט את ההיסוס וכתב רק "כן" —
**זו שגיאה קריטית.** היסוסים משפיעים על מהימנות העדות ועל הרושם שהשופט מקבל.

## מה לא לדווח (רעש):
- ❌ רווחים חסרים אחרי שם דובר
- ❌ הבדלי פיסוק (נקודה, פסיק, סימן שאלה)
- ❌ הבדלי עיצוב ופורמט
- ❌ שינויי ניסוח קלים שאינם משנים משמעות
- ❌ הבדלים שנובעים מטעות של Whisper (לא של הפרוטוקול)

## מה כן לדווח — סיווג:

### 🔴 קריטי — שינוי משמעות העדות:
- השמטה או הוספה של "לא" (הופך עדות חיובית לשלילית)
- החלפת "כן" ב"לא" או להיפך
- שיוך דובר שגוי: הפרוטוקול מייחס משפט לשופט כשעורך הדין אמר אותו, או להיפך (קריטי!)
- השמטת היסוסים של עד שמשפיעים על מהימנות ("לא... אני... כן" הפך ל"כן")
- השמטת בכי, שתיקה ארוכה, או תגובה רגשית שמשפיעה על רושם העד
- קיפול שתיקות: פער ארוך באודיו ש"קופל" בפרוטוקול כאילו העד ענה מיד
- שינוי שמות של אנשים, מקומות, חברות (רק אם ה-PDF שגה, לא Whisper)
- שינוי מספרים, סכומים, תאריכים, כתובות
- השמטת משפט שלם או חלק מהותי ממשפט
- שינוי נושא/מושא ("הוא"/"היא", "שלי"/"שלו")

### 🟡 בינוני — שינוי גוון העדות:
- שינוי גוף דיבור ("אמרתי" במקום "אמרת")
- החלפת מילים נרדפות שמשנות גוון ("סירב" ≠ "לא רצה")
- השמטת מילות קישור שמשנות הקשר ("למרות ש-", "אבל")
- "החלקה" של עדות — הפרוטוקול מחליק ניסוח מגומגם לניסוח שוטף

### 🟢 נמוך — סטייה קלה שכדאי לציין:
- שינוי זמן פועל ללא שינוי משמעות
- מילה שנוספה/הושמטה ולא משנה את התמונה הכללית

## פורמט התשובה
החזר אובייקט JSON בלבד:
{"discrepancies": [{ "timestamp": "MM:SS", "originalText": "הטקסט מהפרוטוקול (PDF)", "correctedText": "מה שנאמר בפועל באודיו", "significance": "קריטי/בינוני/נמוך", "explanation": "הסבר + השלכה משפטית" }]}

אם לא נמצאו שגיאות מהותיות: {"discrepancies": []}`;

// ── Chunking ───────────────────────────────────────────────────────
const MAX_CHUNK_CHARS = 2000; // smaller chunks = more thorough analysis

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n/);
  let current = "";

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += paragraph + "\n";
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Align PDF and Whisper chunks by splitting both to the same count.
 * If one text has more chunks, we pair them as best as possible.
 */
function alignChunks(
  pdfChunks: string[],
  whisperChunks: string[]
): Array<{ pdf: string; whisper: string; index: number }> {
  const maxLen = Math.max(pdfChunks.length, whisperChunks.length);
  const pairs: Array<{ pdf: string; whisper: string; index: number }> = [];

  for (let i = 0; i < maxLen; i++) {
    const pdfIdx = Math.min(
      Math.round((i / maxLen) * pdfChunks.length),
      pdfChunks.length - 1
    );
    const whisperIdx = Math.min(
      Math.round((i / maxLen) * whisperChunks.length),
      whisperChunks.length - 1
    );
    pairs.push({
      pdf: pdfChunks[pdfIdx],
      whisper: whisperChunks[whisperIdx],
      index: i,
    });
  }

  // Deduplicate identical pairs
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const key = `${p.pdf}|||${p.whisper}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function analyzeChunk(
  openai: OpenAI,
  pdfChunk: string,
  whisperChunk: string,
  chunkIndex: number,
  totalChunks: number
): Promise<Discrepancy[]> {
  const userMessage = `## קטע ${chunkIndex + 1} מתוך ${totalChunks}

### טקסט PDF (פרוטוקול בית המשפט):
${pdfChunk}

### תמליל Whisper (האודיו המקורי — מקור האמת):
${whisperChunk}

השווה מילה-במילה. מצא כל הבדל.`;

  // Log the exact prompt being sent
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[analyze] PROMPT FOR CHUNK ${chunkIndex + 1}/${totalChunks}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`[analyze] System prompt: ${SYSTEM_PROMPT.substring(0, 200)}...`);
  console.log(`[analyze] User message (${userMessage.length} chars):`);
  console.log(`[analyze] PDF chunk (${pdfChunk.length} chars): "${pdfChunk.substring(0, 150)}..."`);
  console.log(`[analyze] Whisper chunk (${whisperChunk.length} chars): "${whisperChunk.substring(0, 150)}..."`);
  console.log(`${"=".repeat(70)}\n`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.05, // near-zero for maximum consistency
    response_format: { type: "json_object" },
    max_tokens: 4000,
  });

  const content = response.choices[0]?.message?.content;
  console.log(`[analyze] GPT response for chunk ${chunkIndex + 1}:`, content?.substring(0, 300));

  if (!content) {
    console.warn(`[analyze] Empty response for chunk ${chunkIndex + 1}`);
    return [];
  }

  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.discrepancies)
        ? parsed.discrepancies
        : Array.isArray(parsed.errors)
          ? parsed.errors
          : Array.isArray(parsed.results)
            ? parsed.results
            : [];

    const discrepancies = items.map(
      (item: Record<string, string>): Discrepancy => ({
        timestamp: item.timestamp || "00:00",
        originalText: item.originalText || "",
        correctedText: item.correctedText || "",
        significance:
          (item.significance as Discrepancy["significance"]) || "נמוך",
        explanation: item.explanation || "",
      })
    );

    console.log(
      `[analyze] Chunk ${chunkIndex + 1}: found ${discrepancies.length} discrepancies ` +
        `(${discrepancies.filter((d: Discrepancy) => d.significance === "קריטי").length} critical)`
    );

    return discrepancies;
  } catch (parseError) {
    console.error("[analyze] Failed to parse GPT response:", content);
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

    if (!pdfText || !whisperText) {
      return jsonResponse({ error: "חסר טקסט PDF או תמליל Whisper" }, 400);
    }

    console.log(`\n${"#".repeat(70)}`);
    console.log(`[analyze] === NEW ANALYSIS ===`);
    console.log(`[analyze] PDF text: ${pdfText.length} chars`);
    console.log(`[analyze] Whisper text: ${whisperText.length} chars`);
    console.log(`[analyze] PDF preview: "${pdfText.substring(0, 200)}..."`);
    console.log(`[analyze] Whisper preview: "${whisperText.substring(0, 200)}..."`);
    console.log(`${"#".repeat(70)}\n`);

    const pdfChunks = chunkText(pdfText, MAX_CHUNK_CHARS);
    const whisperChunks = chunkText(whisperText, MAX_CHUNK_CHARS);

    console.log(
      `[analyze] Split into ${pdfChunks.length} PDF chunks and ${whisperChunks.length} Whisper chunks`
    );

    const pairs = alignChunks(pdfChunks, whisperChunks);
    console.log(`[analyze] Aligned into ${pairs.length} comparison pairs`);

    const allDiscrepancies: Discrepancy[] = [];

    for (const pair of pairs) {
      const discrepancies = await analyzeChunk(
        openai,
        pair.pdf,
        pair.whisper,
        pair.index,
        pairs.length
      );
      allDiscrepancies.push(...discrepancies);
    }

    // Sort by timestamp
    allDiscrepancies.sort((a, b) => {
      const timeToSeconds = (t: string) => {
        const parts = t.split(":").map(Number);
        return (parts[0] || 0) * 60 + (parts[1] || 0);
      };
      return timeToSeconds(a.timestamp) - timeToSeconds(b.timestamp);
    });

    // Summary
    const critical = allDiscrepancies.filter(
      (d) => d.significance === "קריטי"
    ).length;
    const medium = allDiscrepancies.filter(
      (d) => d.significance === "בינוני"
    ).length;
    const low = allDiscrepancies.filter(
      (d) => d.significance === "נמוך"
    ).length;

    console.log(`\n${"#".repeat(70)}`);
    console.log(`[analyze] === ANALYSIS COMPLETE ===`);
    console.log(`[analyze] Total: ${allDiscrepancies.length} discrepancies`);
    console.log(`[analyze] קריטי: ${critical} | בינוני: ${medium} | נמוך: ${low}`);
    console.log(`${"#".repeat(70)}\n`);

    return jsonResponse({
      discrepancies: allDiscrepancies,
      totalFound: allDiscrepancies.length,
      chunksAnalyzed: pairs.length,
      summary: { critical, medium, low },
    });
  } catch (error) {
    return errorResponse("analyze", error, "שגיאה בניתוח הטקסטים");
  }
}
