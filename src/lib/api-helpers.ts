import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function json(data: any, status = 200, cacheSeconds = 0) {
  const headers: Record<string, string> = {};
  if (cacheSeconds > 0) {
    headers["Cache-Control"] = `s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`;
  }
  return NextResponse.json(data, { status, headers });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function getSession() {
  return auth();
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) return null;
  return session;
}

export async function requireRole(...roles: Role[]) {
  const session = await requireAuth();
  if (!session) return null;
  const userRole = (session.user as any).role as Role;
  if (!roles.includes(userRole)) return null;
  return session;
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Multi-office scoping helpers
//
// Roles & their scope:
//   SUPER_ADMIN  — god mode across all offices. No filter applied.
//   PARTNER      — admin for the teams where Team.partnerId = self.id.
//                  Can read/write any user/payroll/fine for those teams' members.
//                  Cannot see siblings' teams in the same office.
//                  Gated behind ENABLE_PARTNER_ROLES env flag — when off, PARTNER
//                  scoping is rejected (403) so adding a partner to the DB doesn't
//                  silently take effect before the rollout is ready.
//   MANAGER      — unchanged from pre-multi-office behavior (Izaan).
//   EMPLOYEE     — self only.
//
// Authorization decisions live next to data access (per-route guards), not
// in middleware. The helpers below all return a NextResponse on failure
// (caller does `if (gate) return gate;`) or null on success.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function isPartnerRolesEnabled(): boolean {
  return process.env.ENABLE_PARTNER_ROLES === "true";
}

export interface CallerScope {
  userId: string;
  role: Role;
  officeId: string;
  isCeo: boolean;
  isPartner: boolean;
  /** Teams the caller manages (only populated for PARTNER). null for CEO = unrestricted. */
  teamIds: Set<string> | null;
}

/**
 * Resolves the caller's scope from the session. Use as the first line of any
 * handler that needs to enforce office/team boundaries.
 *
 * Returns null if the caller has no scope at all (no session, no office, etc.) —
 * the caller should treat that as 401/403.
 */
export async function getCallerScope(session: { user: { id: string } } | null | undefined): Promise<CallerScope | null> {
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      role: true,
      officeId: true,
      partnerTeams: { select: { id: true } },
    },
  });
  if (!user) return null;

  const isCeo = user.role === "SUPER_ADMIN";
  const isPartner = user.role === "PARTNER" && isPartnerRolesEnabled();

  return {
    userId: user.id,
    role: user.role,
    officeId: user.officeId,
    isCeo,
    isPartner,
    teamIds: isCeo ? null : new Set(user.partnerTeams.map((t) => t.id)),
  };
}

/**
 * Asserts the caller can act on the target user. Returns null on success,
 * a NextResponse 403 on failure.
 *
 * Rules:
 *   CEO            → always allowed
 *   PARTNER        → target must belong to one of the caller's teams
 *   MANAGER        → unchanged (caller can act on direct reports only — not enforced here yet)
 *   EMPLOYEE       → only on themselves
 *   anyone else    → denied
 */
export async function assertCanActOnUser(
  scope: CallerScope,
  targetUserId: string
): Promise<NextResponse | null> {
  if (scope.isCeo) return null;
  if (scope.userId === targetUserId) return null;

  if (scope.isPartner) {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { teamId: true, officeId: true },
    });
    if (!target) return error("Target user not found", 404);
    if (target.officeId !== scope.officeId) return error("Forbidden", 403);
    if (!target.teamId || !scope.teamIds?.has(target.teamId)) {
      return error("Forbidden", 403);
    }
    return null;
  }

  return error("Forbidden", 403);
}

/**
 * Asserts the caller can act on a specific payroll record. Looks up the
 * record's owner and delegates to assertCanActOnUser.
 */
export async function assertCanActOnPayroll(
  scope: CallerScope,
  payrollRecordId: string
): Promise<NextResponse | null> {
  const record = await prisma.payrollRecord.findUnique({
    where: { id: payrollRecordId },
    select: { userId: true },
  });
  if (!record) return error("Payroll record not found", 404);
  return assertCanActOnUser(scope, record.userId);
}

/**
 * Asserts the caller can act on a specific fine. Looks up the recipient and
 * delegates to assertCanActOnUser.
 */
export async function assertCanActOnFine(
  scope: CallerScope,
  fineId: string
): Promise<NextResponse | null> {
  const fine = await prisma.fine.findUnique({
    where: { id: fineId },
    select: { userId: true },
  });
  if (!fine) return error("Fine not found", 404);
  return assertCanActOnUser(scope, fine.userId);
}

/**
 * Asserts the caller can act on a specific leave request.
 */
export async function assertCanActOnLeave(
  scope: CallerScope,
  leaveRequestId: string
): Promise<NextResponse | null> {
  const lr = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: { userId: true },
  });
  if (!lr) return error("Leave request not found", 404);
  return assertCanActOnUser(scope, lr.userId);
}

/**
 * Returns a Prisma `where` fragment that scopes a User-related query to the
 * caller's reachable users. CEO → no filter. PARTNER → users on their teams.
 * EMPLOYEE → just themselves. Use as a spread into existing where clauses:
 *
 *   const where = { ...userScopeFilter(scope), status: "HIRED" };
 */
export function userScopeFilter(scope: CallerScope): Record<string, any> {
  if (scope.isCeo) return {};
  if (scope.isPartner) {
    const ids = [...(scope.teamIds ?? [])];
    return { officeId: scope.officeId, teamId: { in: ids } };
  }
  return { id: scope.userId };
}

/**
 * Records a write action to the AuditLog table for forensic / "what did
 * each partner do this week" reviews. Intentionally fire-and-forget — never
 * block the user-facing request on audit log failure.
 */
export function auditLog(
  scope: Pick<CallerScope, "userId" | "officeId">,
  action: string,
  opts: { targetId?: string; metadata?: any } = {}
): void {
  prisma.auditLog
    .create({
      data: {
        actorId: scope.userId,
        action,
        targetId: opts.targetId ?? null,
        officeId: scope.officeId ?? null,
        metadata: opts.metadata ?? undefined,
      },
    })
    .catch((err) => {
      console.warn(`[audit] log failed for action=${action}:`, err.message);
    });
}
