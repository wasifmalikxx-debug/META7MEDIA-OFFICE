import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRODUCTION DATABASE_URL TUNING — DO NOT REGRESS WITHOUT CARE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Supabase pooler (port 6543) caps at 200 client connections. In a
// serverless environment, every cold function instance creates its
// own Prisma client and reserves `connection_limit` connections from
// the pooler. With 25+ concurrent function instances during a traffic
// spike, a value as low as 10 puts us OVER the 200 cap and every
// request after that fails with:
//
//   FATAL: max client connections reached, limit: 200
//
// Vercel returns those as `---` (no status) in runtime logs and the
// user sees the generic "A server error occurred. Reload to try
// again." Next.js error page.
//
// On 2026-05-25 the prod URL was running with connection_limit=10
// and the CEO reported portal-wide outages during peak hours. Fix
// was to drop it to 2:
//
//   DATABASE_URL=...:6543/...?sslmode=require&pgbouncer=true
//                            &connection_limit=2&pool_timeout=15
//
// Rule of thumb for this stack:
//   - serverless on Vercel + Supabase pooler → connection_limit=2
//   - pool_timeout=15 (down from 30s — fail fast, don't hang the user)
//
// If you ever raise connection_limit, do the math first:
//   maxConcurrentInstances × connection_limit < 200
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-memory settings cache (avoids querying DB on every request)
//
// Multi-office aware:
//   - getCachedSettings()           → returns the PRIMARY office's settings (OFFICE 1).
//                                      Backwards-compat for callers without office context.
//   - getCachedSettings(officeId)   → returns that specific office's settings.
//   - getCachedSettingsForUser(uid) → resolves the user's officeId then returns settings.
//
// Cache is a Map keyed by officeId (or "__primary__" for the default lookup).
// 60-second TTL per entry. invalidateSettingsCache() drops everything.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CACHE_TTL = 60_000; // 60 seconds
const PRIMARY_KEY = "__primary__";

interface CacheEntry {
  data: any;
  timestamp: number;
}

const settingsCache = new Map<string, CacheEntry>();

export async function getCachedSettings(officeId?: string) {
  const key = officeId ?? PRIMARY_KEY;
  const now = Date.now();
  const cached = settingsCache.get(key);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  let settings: any = null;

  if (officeId) {
    settings = await prisma.officeSettings.findUnique({ where: { officeId } });
  } else {
    // Default lookup: the primary office's settings (OFFICE 1).
    const primary = await prisma.office.findFirst({
      where: { isPrimary: true },
      select: { id: true },
    });
    if (primary) {
      settings = await prisma.officeSettings.findUnique({ where: { officeId: primary.id } });
    }
  }

  // Final-fallback: legacy id="default" row, in case a partial migration state
  // ever leaves a row without officeId. Should never hit in practice after Phase 2.
  if (!settings) {
    settings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
  }

  settingsCache.set(key, { data: settings, timestamp: now });
  return settings;
}

/**
 * Convenience: resolve a user's office and return that office's settings.
 * Used by services that have a userId but not an officeId in scope.
 */
export async function getCachedSettingsForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { officeId: true },
  });
  return getCachedSettings(user?.officeId);
}

export function invalidateSettingsCache() {
  settingsCache.clear();
}
