import {
  Document,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
  PageNumber,
  NumberFormat,
  Footer,
  Header,
  ShadingType,
} from "docx";
import type { Discrepancy } from "@/lib/types";

export interface LegalDocxOptions {
  courtName: string;
  caseNumber: string;
  plaintiffName: string;
  defendantName: string;
  fileName: string;
  discrepancies: Discrepancy[];
  transcriberName: string;
  transcriberIdNumber: string;
}

const DEFAULT_OPTIONS: LegalDocxOptions = {
  courtName: "בית המשפט המחוזי",
  caseNumber: "___/____",
  plaintiffName: "____________",
  defendantName: "____________",
  fileName: "",
  discrepancies: [],
  transcriberName: "____________",
  transcriberIdNumber: "____________",
};

function rtlRun(text: string, opts?: { bold?: boolean; size?: number; font?: string; underline?: object }) {
  return new TextRun({
    text,
    rightToLeft: true,
    font: opts?.font || "David",
    size: opts?.size || 24,
    bold: opts?.bold,
    underline: opts?.underline,
  });
}

function emptyLine() {
  return new Paragraph({
    bidirectional: true,
    children: [rtlRun("")],
  });
}

function createDiscrepancyTable(discrepancies: Discrepancy[]) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 3000, type: WidthType.DXA },
        shading: { type: ShadingType.SOLID, color: "E8E8E8" },
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [rtlRun("טקסט המקור (פרוטוקול)", { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 3500, type: WidthType.DXA },
        shading: { type: ShadingType.SOLID, color: "E8E8E8" },
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [rtlRun("תיקון אנושי וזמן", { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 3000, type: WidthType.DXA },
        shading: { type: ShadingType.SOLID, color: "E8E8E8" },
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [rtlRun("משמעות הטעות", { bold: true, size: 22 })],
          }),
        ],
      }),
    ],
  });

  // Only include rows that have been human-verified or manually corrected
  const exportRows = discrepancies.filter(
    (d) => d.humanVerified || d.correctedText.trim().length > 0
  );

  const dataRows = exportRows.map(
    (d) =>
      new TableRow({
        children: [
          // Col 1: מקור (PDF)
          new TableCell({
            width: { size: 3000, type: WidthType.DXA },
            children: [
              new Paragraph({
                bidirectional: true,
                children: [rtlRun(d.originalText, { size: 22 })],
              }),
            ],
          }),
          // Col 2: תיקון ידני + timestamp + verified marker
          new TableCell({
            width: { size: 3500, type: WidthType.DXA },
            children: [
              new Paragraph({
                bidirectional: true,
                children: [
                  rtlRun(`[${d.timestamp}] `, { bold: true, size: 22 }),
                  rtlRun(d.correctedText || "(לא תוקן)", { size: 22 }),
                ],
              }),
              ...(d.auditorNotes
                ? [
                    new Paragraph({
                      bidirectional: true,
                      children: [
                        rtlRun(`הערת מבקר: ${d.auditorNotes}`, { size: 18 }),
                      ],
                    }),
                  ]
                : []),
              new Paragraph({
                bidirectional: true,
                children: [
                  rtlRun(
                    d.humanVerified
                      ? "✓ נבדק ואומת ידנית על ידי מומחה משפטי"
                      : "⚠ טרם אומת ידנית",
                    { bold: true, size: 18 }
                  ),
                ],
              }),
            ],
          }),
          // Col 3: משמעות + סיווג
          new TableCell({
            width: { size: 3000, type: WidthType.DXA },
            children: [
              new Paragraph({
                bidirectional: true,
                children: [
                  rtlRun(`[${d.significance}] `, { bold: true, size: 22 }),
                  rtlRun(d.explanation, { size: 22 }),
                ],
              }),
            ],
          }),
        ],
      })
  );

  return new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
  });
}

export function generateLegalDocx(
  userOptions: Partial<LegalDocxOptions> = {}
): Document {
  const opts = { ...DEFAULT_OPTIONS, ...userOptions };
  const today = new Date().toLocaleDateString("he-IL");

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "David", size: 24, rightToLeft: true },
        },
      },
    },
    sections: [
      // ── PAGE 1: Motion ─────────────────────────────────────────
      {
        properties: {
          page: {
            pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                children: [
                  rtlRun(`${opts.courtName}`, { bold: true, size: 26 }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                children: [
                  rtlRun("עמוד "),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: "David",
                    size: 20,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Court header
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [
              rtlRun("בקשה לתיקון פרוטוקול", {
                bold: true,
                size: 32,
                underline: {},
              }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [
              rtlRun(
                `לפי סעיף 68א(ד) לחוק בתי המשפט [נוסח משולב], תשמ"ד-1984`,
                { size: 22 }
              ),
            ],
          }),
          emptyLine(),

          // Case details
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun("תיק מספר: ", { bold: true }),
              rtlRun(opts.caseNumber),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun("התובע/המבקש: ", { bold: true }),
              rtlRun(opts.plaintiffName),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun("נ ג ד", { bold: true }),
            ],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun("הנתבע/המשיב: ", { bold: true }),
              rtlRun(opts.defendantName),
            ],
          }),
          emptyLine(),

          // Date
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun("תאריך: ", { bold: true }),
              rtlRun(today),
            ],
          }),
          emptyLine(),

          // Heading
          new Paragraph({
            bidirectional: true,
            heading: HeadingLevel.HEADING_2,
            children: [
              rtlRun("כבוד בית המשפט,", { bold: true, size: 26 }),
            ],
          }),
          emptyLine(),

          // Body
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun(
                `הריני מתכבד/ת להגיש בקשה לתיקון הפרוטוקול מיום הדיון, וזאת בהתאם לסעיף 68א(ד) לחוק בתי המשפט. ` +
                  `במהלך בדיקה שנערכה באמצעות מערכת ממוחשבת להשוואת הקלטות מול פרוטוקול בית המשפט, ` +
                  `נמצאו אי-התאמות מהותיות בין ההקלטה לבין הפרוטוקול הרשמי. ` +
                  `להלן פירוט השגיאות שנמצאו:`
              ),
            ],
          }),
          emptyLine(),

          // Discrepancy count
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun(`סה"כ נמצאו `, { bold: true }),
              rtlRun(`${opts.discrepancies.length}`, { bold: true, size: 26 }),
              rtlRun(` אי-התאמות, מתוכן:`, { bold: true }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun(
                `• שגיאות קריטיות: ${opts.discrepancies.filter((d) => d.significance === "קריטי").length}`
              ),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun(
                `• שגיאות בינוניות: ${opts.discrepancies.filter((d) => d.significance === "בינוני").length}`
              ),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun(
                `• שגיאות קלות: ${opts.discrepancies.filter((d) => d.significance === "נמוך").length}`
              ),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun(
                `• אומתו ונבדקו ידנית: ${opts.discrepancies.filter((d) => d.humanVerified).length} מתוך ${opts.discrepancies.length}`
              ),
            ],
          }),
          emptyLine(),

          // Table heading
          new Paragraph({
            bidirectional: true,
            heading: HeadingLevel.HEADING_3,
            children: [
              rtlRun("טבלת השגיאות שנמצאו:", {
                bold: true,
                size: 24,
                underline: {},
              }),
            ],
          }),
          emptyLine(),

          // Discrepancy table
          createDiscrepancyTable(opts.discrepancies),
          emptyLine(),

          // Closing
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun(
                `לאור האמור לעיל, מתבקש בית המשפט הנכבד להורות על תיקון הפרוטוקול ` +
                  `בהתאם לתיקונים המפורטים בטבלה שלעיל.`
              ),
            ],
          }),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            children: [rtlRun("בכבוד רב,")],
          }),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            children: [rtlRun("________________")],
          }),
          new Paragraph({
            bidirectional: true,
            children: [rtlRun("חתימת עורך הדין / המבקש")],
          }),
        ],
      },

      // ── PAGE 2: Transcriber's Affidavit ────────────────────────
      {
        properties: {},
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [
              rtlRun("תצהיר מתמלל", {
                bold: true,
                size: 32,
                underline: {},
              }),
            ],
          }),
          emptyLine(),

          // Warning
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [
              rtlRun("א ז ה ר ה", { bold: true, size: 28 }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            children: [
              rtlRun(
                `עליך לומר את האמת בלבד, ואם לא תעשה/י כן תהיה/י צפוי/ה ` +
                  `לעונשים הקבועים בחוק.`,
                { bold: true }
              ),
            ],
          }),
          emptyLine(),

          // Affidavit body
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun("אני, החתום/ה מטה, ", { bold: true }),
              rtlRun(opts.transcriberName, { bold: true }),
              rtlRun(", ת.ז. ", { bold: true }),
              rtlRun(opts.transcriberIdNumber, { bold: true }),
              rtlRun(
                `, לאחר שהוזהרתי כי עליי לומר את האמת בלבד וכי אהיה צפוי/ה ` +
                  `לעונשים הקבועים בחוק אם לא אעשה כן, מצהיר/ה בזאת כדלקמן:`
              ),
            ],
          }),
          emptyLine(),

          // Clauses
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun("1. ", { bold: true }),
              rtlRun(
                `אני מתמלל/ת מקצועי/ת ובעל/ת ניסיון בתמלול הקלטות משפטיות.`
              ),
            ],
          }),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun("2. ", { bold: true }),
              rtlRun(
                `ביצעתי השוואה מדוקדקת בין הקלטת הדיון לבין הפרוטוקול הרשמי שנערך על ידי מערכת התמלול.`
              ),
            ],
          }),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun("3. ", { bold: true }),
              rtlRun(
                `מצאתי את אי-ההתאמות המפורטות בטבלה המצורפת. כל תיקון נבדק על ידי ` +
                  `באופן ידני תוך האזנה חוזרת להקלטה.`
              ),
            ],
          }),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            indent: { right: 500 },
            children: [
              rtlRun("4. ", { bold: true }),
              rtlRun(
                `תצהיר זה נערך לתמיכה בבקשה לתיקון הפרוטוקול כאמור.`
              ),
            ],
          }),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun(`ולראיה באתי על החתום, היום ${today}.`),
            ],
          }),
          emptyLine(),
          emptyLine(),

          // Signature blocks
          new Paragraph({
            bidirectional: true,
            children: [rtlRun("________________")],
          }),
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun("חתימת המצהיר/ה: "),
              rtlRun(opts.transcriberName),
            ],
          }),
          emptyLine(),
          emptyLine(),

          // Lawyer verification
          new Paragraph({
            bidirectional: true,
            heading: HeadingLevel.HEADING_3,
            children: [
              rtlRun("אישור עורך דין", {
                bold: true,
                underline: {},
              }),
            ],
          }),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            children: [
              rtlRun(
                `אני, ________________, עו"ד, מאשר/ת בזאת כי ביום ${today} ` +
                  `הופיע/ה בפניי ${opts.transcriberName}, ` +
                  `ת.ז. ${opts.transcriberIdNumber}, ` +
                  `ולאחר שהזהרתיו/ה כי עליו/ה להצהיר את האמת בלבד ` +
                  `וכי יהיה/תהיה צפוי/ה לעונשים הקבועים בחוק אם לא יעשה/תעשה כן, ` +
                  `אישר/ה את נכונות הצהרתו/ה וחתם/ה עליה בפניי.`
              ),
            ],
          }),
          emptyLine(),
          emptyLine(),
          new Paragraph({
            bidirectional: true,
            children: [rtlRun("________________")],
          }),
          new Paragraph({
            bidirectional: true,
            children: [rtlRun(`חתימת עורך הדין ומספר רישיון`)],
          }),
        ],
      },
    ],
  });

  return doc;
}
