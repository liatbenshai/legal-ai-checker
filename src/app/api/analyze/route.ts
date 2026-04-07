import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

// ── Strict legal proofreader prompt ────────────────────────────────
const SYSTEM_PROMPT = `אתה מבקר תמלילים משפטיים בכיר עם 30 שנות ניסיון בפרוטוקולים של בתי משפט בישראל.

## המשימה שלך
עליך להשוות מילה-במילה בין שני טקסטים:
1. **טקסט PDF** — הפרוטוקול הרשמי של בית המשפט (ייתכן שנוצר על ידי מערכת תמלול אוטומטית).
2. **תמליל Whisper** — תמלול מדויק של הקלטת האודיו המקורית (זהו מקור האמת).

## מדיניות אפס סובלנות
כל שוני בין הפרוטוקול (PDF) לבין ההקלטה (Whisper) הוא שגיאה. אין חריגים.
גם הבדל של מילה אחת, גם שינוי סדר מילים, גם השמטה של מילת קישור — הכל חייב להיות מדווח.

## סיווג השגיאות

### קריטי — שגיאות שמשנות את משמעות העדות:
- השמטה או הוספה של המילה "לא" (הופך עדות חיובית לשלילית או להיפך)
- החלפת "כן" ב"לא" או להיפך
- שינוי שמות של אנשים, מקומות, או חברות
- שינוי מספרים, סכומים, תאריכים, או כתובות
- השמטת משפט שלם או חלק ממשפט
- החלפת מילים שמשנה את הנושא או המושא ("הוא" במקום "היא", "שלי" במקום "שלו")
- בלבול הומופונים קריטי: "קול"/"כל", "עד"/"עוד", "דין"/"דיין"

### בינוני — שגיאות דקדוקיות או בחירת מילים שונה:
- שינוי זמן הפועל ("אמר" במקום "אומר")
- שינוי גוף ("אתה" במקום "אני", "אמרתי" במקום "אמרת")
- החלפת מילים נרדפות שמשנות גוון ("סירב" במקום "לא הסכים")
- השמטת מילות קישור ("ש-", "כי", "אבל", "גם")
- שינוי סדר מילים שמשנה דגש

### נמוך — הבדלי ניסוח וסגנון:
- מילות מילוי ("אממ", "נו", "אה") שנוספו או הושמטו
- הבדלי פיסוק וסימני שאלה
- שינויי ניסוח שאינם משנים משמעות כלל

## כללים קריטיים
1. אתה חייב למצוא כל הבדל — אפילו הקטן ביותר.
2. אם הטקסטים אינם זהים ב-100%, יש שגיאות — מצא אותן.
3. בדוק כל משפט בנפרד. אל תדלג על שום חלק.
4. ה-timestamp צריך להתאים למיקום המשוער בהקלטה (MM:SS).
5. בשדה originalText — כתוב את הטקסט כפי שמופיע ב-PDF (השגוי).
6. בשדה correctedText — כתוב את הטקסט כפי שמופיע ב-Whisper (הנכון).
7. בשדה explanation — הסבר מדוע זו שגיאה ומה ההשלכה המשפטית.

## פורמט התשובה
החזר אובייקט JSON בפורמט הבא בלבד, ללא טקסט נוסף:
{"discrepancies": [{ "timestamp": "MM:SS", "originalText": "הטקסט מה-PDF", "correctedText": "הטקסט מה-Whisper", "significance": "קריטי/בינוני/נמוך", "explanation": "הסבר מפורט" }]}

אם באמת אין שום הבדל (הטקסטים זהים לחלוטין): {"discrepancies": []}`;

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
