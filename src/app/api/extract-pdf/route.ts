import { NextRequest } from "next/server";
import { extractText } from "unpdf";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars("NEXT_PUBLIC_SUPABASE_URL");
    if (envError) return envError;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return jsonResponse({ error: "לא נבחר קובץ PDF" }, 400);
    }

    if (file.type !== "application/pdf") {
      return jsonResponse({ error: "הקובץ שהועלה אינו PDF" }, 400);
    }

    console.log(`[extract-pdf] Processing file: ${file.name} (${file.size} bytes)`);

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await extractText(new Uint8Array(arrayBuffer));

    // pdf.text is string[] (one entry per page) — join all pages
    const text = (Array.isArray(pdf.text) ? pdf.text.join("\n") : String(pdf.text)).trim();

    console.log(`[extract-pdf] Extracted ${text.length} chars from ${pdf.totalPages} pages`);

    if (text.length < 50) {
      return jsonResponse({
        text: "",
        warning: "נראה שה-PDF סרוק. נדרש OCR כדי להמשיך.",
        isScanned: true,
      });
    }

    return jsonResponse({
      text,
      pages: pdf.totalPages,
      isScanned: false,
    });
  } catch (error) {
    return errorResponse("extract-pdf", error, "שגיאה בעיבוד קובץ ה-PDF");
  }
}
