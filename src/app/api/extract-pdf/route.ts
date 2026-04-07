import { NextRequest } from "next/server";
import { PDFParse } from "pdf-parse";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  try {
    // No env vars needed for PDF extraction, but validate Supabase for consistency
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

    const buffer = Buffer.from(await file.arrayBuffer());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new PDFParse({ data: buffer }) as any;
    await parser.load();

    // getText() returns { pages: [...], text: string, total: number }
    const textResult = await parser.getText();
    const text: string = (textResult?.text ?? "").trim();

    console.log(`[extract-pdf] Extracted ${text.length} characters`);

    if (text.length < 50) {
      return jsonResponse({
        text: "",
        warning: "נראה שה-PDF סרוק. נדרש OCR כדי להמשיך.",
        isScanned: true,
      });
    }

    // getInfo() returns { total: number, info: {...}, ... }
    const info = await parser.getInfo();

    return jsonResponse({
      text,
      pages: info?.total || 0,
      isScanned: false,
    });
  } catch (error) {
    return errorResponse("extract-pdf", error, "שגיאה בעיבוד קובץ ה-PDF");
  }
}
