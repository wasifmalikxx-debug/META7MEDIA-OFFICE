import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Public liveness probe (Aug 2026 — "portal must never be down").
// Point an uptime monitor (UptimeRobot / BetterStack, 1-min interval) at
// https://portal.meta7.media/api/health — it alerts the moment the portal OR
// the database stops answering, instead of waiting for an employee to report
// it. Returns no sensitive data.
//
// Deliberately uses its OWN un-extended PrismaClient: the app singleton
// auto-retries connection blips, but a probe must SEE the first failure —
// a monitor that self-heals defeats its purpose. maxDuration=10 keeps a
// hanging pool from turning the probe into a slow 200.
const probe = new PrismaClient({ log: ["error"] });

export async function GET() {
  const startedAt = Date.now();
  try {
    await probe.$queryRaw`SELECT 1`;
    return Response.json({
      ok: true,
      db: "up",
      latencyMs: Date.now() - startedAt,
      ts: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[health] DB check failed:", err?.message);
    return Response.json(
      { ok: false, db: "down", ts: new Date().toISOString() },
      { status: 503 }
    );
  }
}
