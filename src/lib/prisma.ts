import { PrismaClient } from "@prisma/client";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONNECTION-ERROR AUTO-RETRY (Aug 2026 — "portal must never be down")
//
// Transient infrastructure blips (Supabase pooler saturation, a pooler
// restart, a dropped connect) used to fail the request instantly and the
// user saw a dead error page — reported as "the site is down sometimes".
// Queries now retry on errors that happen strictly BEFORE the statement
// executes, so retrying is safe for reads AND writes alike:
//   P1001 — can't reach database server        (connect failed)    → 2 retries
//   P1002 — server reached but connect timed out                   → 2 retries
//   P2024 — timed out waiting for a pool connection (already spent
//           pool_timeout=15s waiting)                              → 1 retry
//   "Max client connections reached"           (pooler at its 200 cap)
// Mid-query failures (P1017, socket resets/timeouts) are NOT retried — for
// a write that would risk double-applying. Ops inside $transaction are
// NEVER retried (see the guard in $allOperations): fail fast, roll back.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Strictly PRE-EXECUTION errors only. Deliberately excluded: ETIMEDOUT (on an
// established socket it can fire AFTER a statement ran — retrying a write
// could double-apply under future driver adapters), "connection pool"
// (redundant with P2024 and dangerously broad), P1017/"server closed the
// connection" (mid-query, ambiguous for writes).
const RETRYABLE_CODES = new Set(["P1001", "P1002", "P2024"]);
const RETRYABLE_MESSAGE =
  /max client connections|can't reach database server|timed out fetching a new connection/i;

function isRetryableConnectionError(e: any): boolean {
  const code = e?.code ?? e?.errorCode;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  return RETRYABLE_MESSAGE.test(String(e?.message ?? ""));
}

// P2024 (pool-wait timeout) already spent pool_timeout (15s) waiting. More
// than ONE extra attempt turns a 15s failure into ~46s of hanging and feeds
// the very saturation it's reacting to — fast connect errors get 2 retries,
// pool-wait timeouts get 1.
function isPoolWaitTimeout(e: any): boolean {
  const code = e?.code ?? e?.errorCode;
  return code === "P2024" || /timed out fetching a new connection/i.test(String(e?.message ?? ""));
}

function makePrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends({
    query: {
      async $allOperations(params) {
        const { model, operation, args, query } = params;
        // NEVER retry an operation that runs inside a $transaction. Verified
        // against the installed Prisma 6.19 runtime: a retried batch-member
        // loses its batch-transaction context on re-dispatch and executes as
        // a standalone autocommit statement — silently breaking atomicity on
        // money paths (payroll lock, employee-delete cascade). Inside a tx we
        // fail fast so the whole transaction rolls back cleanly instead.
        // (__internalParams is internal API, pinned to prisma 6.x — re-verify
        // on any Prisma upgrade.)
        if ((params as any).__internalParams?.transaction) return query(args);

        let attempt = 0;
        // Short jittered backoff: a pooler spike is usually over in a second
        // or two, so the first retry typically lands.
        for (;;) {
          try {
            return await query(args);
          } catch (e: any) {
            if (!isRetryableConnectionError(e)) throw e;
            const maxAttempts = isPoolWaitTimeout(e) ? 1 : 2;
            if (attempt >= maxAttempts) throw e;
            attempt++;
            const backoff = (attempt === 1 ? 150 : 450) + Math.floor(Math.random() * 150);
            console.warn(
              `[prisma-retry] ${model ?? "$raw"}.${operation} retry ${attempt}/${maxAttempts} in ${backoff}ms after: ${String(e?.message ?? e).slice(0, 140)}`
            );
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof makePrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? makePrismaClient();

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
