import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Discrepancy } from "@/lib/types";
import { DB_TABLE } from "@/lib/constants";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    if (envError) return envError;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // Log project identity so we can verify it matches the dashboard
    console.log(`[save-results] Supabase URL: ${supabaseUrl.substring(0, 30)}...`);
    console.log(`[save-results] Anon key: ${supabaseKey.substring(0, 20)}...`);

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

    const supabase = createClient(supabaseUrl, supabaseKey);

    const analysisResult = {
      discrepancies,
      analyzedAt: new Date().toISOString(),
    };

    // Add timestamp to the filename so each save is unique and visible
    const now = new Date();
    const timeStamp = now.toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const dateStamp = now.toLocaleDateString("he-IL");
    const displayName = transcriptId
      ? fileName
      : `${fileName} (${dateStamp} ${timeStamp})`;

    if (transcriptId) {
      // ── Update existing record ──
      console.log(`[save-results] UPDATE existing transcript: ${transcriptId}`);
      console.log(`[save-results] Discrepancies count: ${discrepancies.length}`);

      try {
        const { data, error } = await supabase
          .from(DB_TABLE)
          .update({
            analysis_result: analysisResult,
            status: "done",
          })
          .eq("id", transcriptId)
          .select("id, file_name")
          .single();

        if (error) {
          console.error("[save-results] UPDATE error:", {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          });
          return jsonResponse(
            {
              error: `שגיאה בעדכון: ${error.message} (${error.code})`,
            },
            500
          );
        }

        console.log(`[save-results] ✅ Updated: ${data.id} — ${data.file_name}`);
        return jsonResponse({ id: transcriptId, updated: true });
      } catch (updateErr) {
        console.error("[save-results] UPDATE exception:", updateErr);
        return jsonResponse({ error: "שגיאה בעדכון התוצאות" }, 500);
      }
    } else {
      // ── Always INSERT a new record (never upsert) ──
      console.log(`[save-results] INSERT new transcript: "${displayName}"`);
      console.log(`[save-results] Discrepancies count: ${discrepancies.length}`);

      try {
        const insertPayload = {
          file_name: displayName,
          analysis_result: analysisResult,
          status: "done",
        };
        console.log("[save-results] 💾 INSERT payload:", JSON.stringify({
          file_name: insertPayload.file_name,
          status: insertPayload.status,
          discrepancies_count: discrepancies.length,
        }));

        const { data, error } = await supabase
          .from(DB_TABLE)
          .insert(insertPayload)
          .select("id, file_name, created_at")
          .single();

        console.log("💾 Database Insert Attempt:", {
          success: !error,
          data: data ? { id: data.id, file_name: data.file_name } : null,
          error: error ? { code: error.code, message: error.message } : null,
        });

        if (error) {
          console.error("❌ SQL Error Details:", error.message, error.details);
          console.error("[save-results] INSERT error:", {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          });
          return jsonResponse(
            {
              error: `שגיאה בשמירה: ${error.message} (${error.code})`,
            },
            500
          );
        }

        console.log(
          `[save-results] ✅ Created: ${data.id} — "${data.file_name}" at ${data.created_at}`
        );
        return jsonResponse({ id: data.id, updated: false });
      } catch (insertErr) {
        console.error("[save-results] INSERT exception:", insertErr);
        return jsonResponse({ error: "שגיאה בשמירת התוצאות" }, 500);
      }
    }
  } catch (error) {
    return errorResponse("save-results", error, "שגיאה בשמירת התוצאות");
  }
}
