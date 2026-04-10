import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Returns the server's current UTC epoch milliseconds.
 *
 * Used by the client to compute an offset against its own Date.now() so all
 * PKT calculations stay correct EVEN IF the user's PC clock is set wrong.
 *
 * Vercel serverless always runs in UTC so Date.now() here is authoritative.
 */
export async function GET() {
  return NextResponse.json(
    { utcMs: Date.now() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    }
  );
}
