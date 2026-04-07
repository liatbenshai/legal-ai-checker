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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // Log project identity — compare with save-results logs
    console.log(`[transcripts] Supabase URL: ${supabaseUrl.substring(0, 30)}...`);
    console.log(`[transcripts] Anon key: ${supabaseKey.substring(0, 20)}...`);

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from("transcripts")
      .select("id, file_name, status, created_at, analysis_result")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[transcripts] Supabase error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return jsonResponse({ error: `שגיאה בטעינת הנתונים: ${error.message}` }, 500);
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

    console.log(`[transcripts] 📊 Total records found: ${transcripts.length}`);
    if (transcripts.length > 0) {
      console.log(`[transcripts] 📋 Newest: "${transcripts[0].fileName}" — ${transcripts[0].createdAt} — status: ${transcripts[0].status}`);
      console.log(`[transcripts] 📋 Oldest: "${transcripts[transcripts.length - 1].fileName}" — ${transcripts[transcripts.length - 1].createdAt}`);
    } else {
      console.log("[transcripts] ⚠️ No records found in 'transcripts' table");
    }

    return jsonResponse({ transcripts });
  } catch (error) {
    return errorResponse("transcripts", error, "שגיאה בטעינת הנתונים");
  }
}
