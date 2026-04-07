import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const envError = validateEnvVars(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    if (envError) return envError;

    const { id } = await params;

    console.log(`[transcripts/${id}] Fetching transcript`);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase
      .from("transcripts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error(`[transcripts/${id}] Supabase error:`, error);
      return jsonResponse({ error: "תמליל לא נמצא" }, 404);
    }

    return jsonResponse({
      id: data.id,
      fileName: data.file_name,
      status: data.status,
      createdAt: data.created_at,
      pdfText: data.pdf_text,
      discrepancies: data.analysis_result?.discrepancies || [],
    });
  } catch (error) {
    return errorResponse("transcripts/[id]", error, "שגיאה בטעינת התמליל");
  }
}
