import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "לא נבחר קובץ PDF" },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "הקובץ שהועלה אינו PDF" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new PDFParse({ data: buffer }) as any;
    await parser.load();
    const text = (await parser.getText() as string).trim();

    if (text.length < 50) {
      return NextResponse.json(
        {
          text: "",
          warning: "נראה שה-PDF סרוק. נדרש OCR כדי להמשיך.",
          isScanned: true,
        },
        { status: 200 }
      );
    }

    const info = await parser.getInfo();

    return NextResponse.json({
      text,
      pages: info?.pages || 0,
      isScanned: false,
    });
  } catch (error) {
    console.error("PDF extraction error:", error);
    return NextResponse.json(
      { error: "שגיאה בעיבוד קובץ ה-PDF" },
      { status: 500 }
    );
  }
}
