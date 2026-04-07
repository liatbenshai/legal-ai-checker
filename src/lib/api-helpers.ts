import { NextResponse } from "next/server";

/**
 * Validate that required environment variables are present.
 * Returns a NextResponse error if any are missing, or null if all are present.
 */
export function validateEnvVars(
  ...keys: string[]
): NextResponse | null {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[ENV] Missing environment variables: ${missing.join(", ")}`);
    return NextResponse.json(
      {
        error: "שגיאת הגדרות שרת — חסרים מפתחות API",
        missing: missing.map((k) =>
          k.startsWith("NEXT_PUBLIC_") ? k : k.replace(/./g, "*")
        ),
      },
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  return null;
}

/**
 * Create a JSON response with explicit Content-Type header.
 */
export function jsonResponse(
  data: unknown,
  status = 200
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a JSON error response with full logging.
 */
export function errorResponse(
  routeName: string,
  error: unknown,
  fallbackMessage: string,
  status = 500
): NextResponse {
  const errorMessage =
    error instanceof Error ? error.message : String(error);
  const errorStack =
    error instanceof Error ? error.stack : undefined;

  console.error(`[${routeName}] Error:`, errorMessage);
  if (errorStack) {
    console.error(`[${routeName}] Stack:`, errorStack);
  }

  return NextResponse.json(
    {
      error: fallbackMessage,
      details:
        process.env.NODE_ENV === "development" ? errorMessage : undefined,
    },
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}
