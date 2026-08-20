import { NextResponse } from "next/server";
import { isMaintenanceMode } from "@/lib/api-helpers";

/**
 * GET /api/maintenance-status — public, unauthenticated, no database.
 *
 * Exists so a browser tab that was already open when the portal was locked
 * finds out. Next's App Router reuses an already-rendered layout for
 * client-side navigation, so the maintenance early-return in
 * (dashboard)/layout.tsx does NOT re-run for a session that was inside the
 * portal when the flag flipped — that tab keeps showing a working shell.
 *
 * Deliberately outside requireAuth: a locked-out session is rejected there,
 * and this has to answer both while locked (so the notice can poll for the
 * reopening) and while open (so the shell can poll for the lock).
 *
 * It leaks one boolean, which the notice screen states in plain English
 * anyway, and it touches no user data and no database.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { maintenance: isMaintenanceMode() },
    // Must never be cached — a stale "false" would leave tabs running.
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
