import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateEnvVars, jsonResponse, errorResponse } from "@/lib/api-helpers";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB hard limit

export async function POST(request: NextRequest) {
  try {
    const envError = validateEnvVars(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    if (envError) return envError;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return jsonResponse({ error: "לא נבחר קובץ אודיו" }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonResponse(
        {
          error: `הקובץ גדול מדי (${(file.size / 1024 / 1024).toFixed(0)}MB). אנא העלו קובץ קטן מ-100MB או פצלו אותו.`,
        },
        413
      );
    }

    console.log(`[upload-audio] Uploading: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Create a unique path: audio-uploads/timestamp_filename
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `uploads/${timestamp}_${safeName}`;

    const buffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("audio-files")
      .upload(storagePath, buffer, {
        contentType: file.type || "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("[upload-audio] Storage upload error:", uploadError);
      return jsonResponse(
        { error: "שגיאה בהעלאת הקובץ לשרת האחסון" },
        500
      );
    }

    // Get a signed URL valid for 1 hour (enough for transcription)
    const { data: urlData, error: urlError } = await supabase.storage
      .from("audio-files")
      .createSignedUrl(storagePath, 3600);

    if (urlError || !urlData?.signedUrl) {
      console.error("[upload-audio] Signed URL error:", urlError);
      return jsonResponse(
        { error: "שגיאה ביצירת קישור לקובץ" },
        500
      );
    }

    console.log(`[upload-audio] Upload complete: ${storagePath}`);

    return jsonResponse({
      url: urlData.signedUrl,
      storagePath,
      fileName: file.name,
      fileSize: file.size,
    });
  } catch (error) {
    return errorResponse("upload-audio", error, "שגיאה בהעלאת קובץ האודיו");
  }
}
