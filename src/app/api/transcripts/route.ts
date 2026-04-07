import { createClient } from "@supabase/supabase-js";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

// Never cache — always fetch fresh data from Supabase
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const envError = validateEnvVars(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    if (envError) return envError;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    console.log("[transcripts] Fetching transcript list");

    const { data, error } = await supabase
      .from("transcripts")
      .select("id, file_name, status, created_at, analysis_result")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[transcripts] Supabase error:", error);
      return jsonResponse({ error: "שגיאה בטעינת הנתונים" }, 500);
    }

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

    console.log(`[transcripts] Returning ${transcripts.length} transcripts`);

    return jsonResponse({ transcripts });
  } catch (error) {
    return errorResponse("transcripts", error, "שגיאה בטעינת הנתונים");
  }
}
