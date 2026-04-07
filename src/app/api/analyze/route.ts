import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { Discrepancy } from "@/lib/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `אתה מבקר תמלילים משפטיים בכיר. עליך להשוות בין טקסט ה-PDF (פרוטוקול בית משפט) לבין תמליל ה-Whisper (האודיו המדויק).
זהה טעויות קריטיות שנובעות מ-AI:

1. השמטת המילה 'לא' (הופך עדות מפוזיטיבית לנגטיבית).
2. בלבול בין מילים שנשמעות דומה (הומופונים) כמו 'קול'/'כל', 'את'/'אל'.
3. שינוי שמות או סכומים.

החזר JSON בפורמט הבא בלבד, ללא טקסט נוסף:
[{ "timestamp": "MM:SS", "originalText": "...", "correctedText": "...", "significance": "קריטי/בינוני/נמוך", "explanation": "..." }]

אם אין טעויות, החזר מערך ריק: []`;

const MAX_CHUNK_CHARS = 3000;

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = "";

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += paragraph + "\n\n";
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

async function analyzeChunk(
  pdfChunk: string,
  whisperChunk: string
): Promise<Discrepancy[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `טקסט PDF (פרוטוקול):\n${pdfChunk}\n\nתמליל Whisper (אודיו):\n${whisperChunk}`,
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    // Handle both array and object with array property
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.discrepancies)
        ? parsed.discrepancies
        : Array.isArray(parsed.errors)
          ? parsed.errors
          : Array.isArray(parsed.results)
            ? parsed.results
            : [];

    return items.map(
      (item: Record<string, string>): Discrepancy => ({
        timestamp: item.timestamp || "00:00",
        originalText: item.originalText || "",
        correctedText: item.correctedText || "",
        significance: (item.significance as Discrepancy["significance"]) || "נמוך",
        explanation: item.explanation || "",
      })
    );
  } catch {
    console.error("Failed to parse GPT response:", content);
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pdfText, whisperText } = body;

    if (!pdfText || !whisperText) {
      return NextResponse.json(
        { error: "חסר טקסט PDF או תמליל Whisper" },
        { status: 400 }
      );
    }

    const pdfChunks = chunkText(pdfText, MAX_CHUNK_CHARS);
    const whisperChunks = chunkText(whisperText, MAX_CHUNK_CHARS);

    // Match chunks by index (best effort alignment)
    const numChunks = Math.max(pdfChunks.length, whisperChunks.length);
    const allDiscrepancies: Discrepancy[] = [];

    for (let i = 0; i < numChunks; i++) {
      const pdfChunk = pdfChunks[Math.min(i, pdfChunks.length - 1)];
      const whisperChunk =
        whisperChunks[Math.min(i, whisperChunks.length - 1)];

      const discrepancies = await analyzeChunk(pdfChunk, whisperChunk);
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

    return NextResponse.json({
      discrepancies: allDiscrepancies,
      totalFound: allDiscrepancies.length,
      chunksAnalyzed: numChunks,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    const message =
      error instanceof Error ? error.message : "שגיאה בניתוח הטקסטים";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
