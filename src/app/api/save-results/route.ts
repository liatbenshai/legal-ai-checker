import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Discrepancy } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      transcriptId,
      fileName,
      discrepancies,
    }: {
      transcriptId?: string;
      fileName: string;
      discrepancies: Discrepancy[];
    } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    if (transcriptId) {
      // Update existing record
      const { error } = await supabase
        .from("transcripts")
        .update({
          analysis_result: { discrepancies },
          status: "done",
        })
        .eq("id", transcriptId);

      if (error) {
        console.error("Supabase update error:", error);
        return NextResponse.json(
          { error: "שגיאה בשמירת התוצאות" },
          { status: 500 }
        );
      }

      return NextResponse.json({ id: transcriptId, updated: true });
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from("transcripts")
        .insert({
          file_name: fileName,
          analysis_result: { discrepancies },
          status: "done",
        })
        .select("id")
        .single();

      if (error) {
        console.error("Supabase insert error:", error);
        return NextResponse.json(
          { error: "שגיאה בשמירת התוצאות" },
          { status: 500 }
        );
      }

      return NextResponse.json({ id: data.id, updated: false });
    }
  } catch (error) {
    console.error("Save error:", error);
    return NextResponse.json(
      { error: "שגיאה בשמירת התוצאות" },
      { status: 500 }
    );
  }
}
