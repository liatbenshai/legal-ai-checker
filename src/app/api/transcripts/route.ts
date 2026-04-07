import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase
      .from("transcripts")
      .select("id, file_name, status, created_at, analysis_result")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "שגיאה בטעינת הנתונים" },
        { status: 500 }
      );
    }

    // Add discrepancy counts
    const transcripts = (data || []).map((t) => {
      const discrepancies = t.analysis_result?.discrepancies || [];
      return {
        id: t.id,
        fileName: t.file_name,
        status: t.status,
        createdAt: t.created_at,
        discrepancyCount: discrepancies.length,
        criticalCount: discrepancies.filter(
          (d: { significance: string }) => d.significance === "קריטי"
        ).length,
      };
    });

    return NextResponse.json({ transcripts });
  } catch (error) {
    console.error("Transcripts list error:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הנתונים" },
      { status: 500 }
    );
  }
}
