import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Discrepancy } from "@/lib/types";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    if (envError) return envError;

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

    const analysisResult = {
      discrepancies,
      analyzedAt: new Date().toISOString(),
    };

    if (transcriptId) {
      console.log(`[save-results] Updating transcript: ${transcriptId}`);
      const { error } = await supabase
        .from("transcripts")
        .update({
          analysis_result: analysisResult,
          status: "done",
        })
        .eq("id", transcriptId);

      if (error) {
        console.error("[save-results] Supabase update error:", error);
        return jsonResponse({ error: "שגיאה בעדכון התוצאות" }, 500);
      }

      return jsonResponse({ id: transcriptId, updated: true });
    } else {
      console.log(`[save-results] Creating new transcript: ${fileName}`);
      const { data, error } = await supabase
        .from("transcripts")
        .insert({
          file_name: fileName,
          analysis_result: analysisResult,
          status: "done",
        })
        .select()
        .single();

      if (error) {
        console.error("[save-results] Supabase insert error:", error);
        return jsonResponse({ error: "שגיאה בשמירת התוצאות" }, 500);
      }

      return jsonResponse({ id: data.id, updated: false });
    }
  } catch (error) {
    return errorResponse("save-results", error, "שגיאה בשמירת התוצאות");
  }
}
