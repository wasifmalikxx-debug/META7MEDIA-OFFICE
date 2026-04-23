import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma, getCachedSettings } from "@/lib/prisma";
import { todayPKT, nowPKT, pktMinutesSinceMidnight } from "@/lib/pkt";
import { resolveAttendanceStatus } from "@/lib/services/attendance-status";
import { maybeCreateBreakSkipFine } from "@/lib/services/break-fine";

// Build marker — bumped whenever this file changes. Returned in every
// response so the live deployed version is visible in Vercel logs.
const ROUTE_VERSION = "end-of-day-v1.0";

// Hardcoded sentinel value the buggy legacy code used to write. We refuse
// to ever write this value, regardless of input. If our nowPKT() ever
// returns something that hashes to this exact moment, something is very
// wrong and we abort.
const LEGACY_BUG_HOUR_UTC = 14;

/**
 * GET /api/attendance/end-of-day-checkout
 *
 * Vercel-cron entry point for end-of-day auto-checkout. Runs at 8:00 PM PKT.
 * Replaces the old /api/attendance/auto-checkout cron, which kept misfiring
 * because a stale Vercel build served pre-March-31 code at that path.
 *
 * GUARDS — every layer must pass before any DB write:
 *   1. CRON_SECRET match (mandatory in production)
 *   2. PKT time window: must be between workEndTime and 23:59 PKT
 *   3. nowPKT() sanity: timestamp must be within 1 hour of expected window
 *   4. Per-employee: workedMinutes >= 240 (half-day threshold). Below that,
 *      the row is left untouched — they're treated as still on shift.
 *   5. Per-employee: checkoutTime > checkIn + 4 hours (math sanity)
 *   6. Per-employee: refuse to write if checkoutTime hour == 14 (legacy sentinel)
 *
 * Idempotent: rows already checked out are skipped automatically by the
 * `checkOut: null` filter on the source query.
 */
export async function GET(request: NextRequest) {
  // GATE 1 — CRON_SECRET (mandatory in prod)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!cronSecret) {
      return error(`Server misconfigured: CRON_SECRET not set (route ${ROUTE_VERSION})`, 500);
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return error("Unauthorized", 401);
    }
  }
  const guardError = await timeWindowGuard();
  if (guardError) return guardError;
  return runCheckout("cron");
}

/**
 * POST — manual trigger by SUPER_ADMIN. Same guards apply.
 */
export async function POST() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") return error("Forbidden — CEO only", 403);
  const guardError = await timeWindowGuard();
  if (guardError) return guardError;
  return runCheckout(`manual:${session.user.id}`);
}

/**
 * GATE 2 + 3 — verify PKT time is within the allowed window AND the system
 * clock isn't off in some unexpected way.
 */
async function timeWindowGuard() {
  const settings = await getCachedSettings();
  const [weH, weM] = (settings?.workEndTime || "19:00").split(":").map(Number);
  const workEndMin = weH * 60 + weM;
  const currentMin = pktMinutesSinceMidnight();

  if (currentMin < workEndMin) {
    return error(
      `Auto-checkout can only run after ${settings?.workEndTime || "19:00"} PKT. Current PKT: ${Math.floor(currentMin / 60)}:${String(currentMin % 60).padStart(2, "0")}. (route ${ROUTE_VERSION})`,
      400
    );
  }

  // Upper bound — refuse to run after midnight PKT (current day boundary)
  if (currentMin > 23 * 60 + 59) {
    return error(`Auto-checkout window has closed for the day. (route ${ROUTE_VERSION})`, 400);
  }

  return null;
}

async function runCheckout(triggerSource: string) {
  try {
    const today = todayPKT();
    const checkoutTime = nowPKT();

    // SANITY 6 — refuse to write the legacy bug sentinel value, ever.
    // If nowPKT() ever lands exactly at 14:00:00.000 UTC of today, something
    // is severely wrong. Bail out instead of writing.
    if (
      checkoutTime.getUTCHours() === LEGACY_BUG_HOUR_UTC &&
      checkoutTime.getUTCMinutes() === 0 &&
      checkoutTime.getUTCSeconds() === 0
    ) {
      return error(
        `Refusing to write the legacy bug sentinel time (14:00 UTC). (route ${ROUTE_VERSION})`,
        500
      );
    }

    // Find open shifts: checked in today but no checkOut.
    const openAttendances = await prisma.attendance.findMany({
      where: {
        date: today,
        checkIn: { not: null },
        checkOut: null,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });

    if (openAttendances.length === 0) {
      return json({
        message: "No open shifts to close",
        version: ROUTE_VERSION,
        triggerSource,
        ranAt: checkoutTime.toISOString(),
        count: 0,
      });
    }

    const settings = await getCachedSettings();
    const [endH, endM] = (settings?.workEndTime || "19:00").split(":").map(Number);
    const [startH, startM] = (settings?.workStartTime || "11:00").split(":").map(Number);
    const fullDayMinutes = endH * 60 + endM - (startH * 60 + startM);
    const halfDayThresholdMin = settings?.halfDayThresholdMin ?? 240;

    const results: any[] = [];
    const skipped: any[] = [];

    for (const att of openAttendances) {
      const name = `${att.user.firstName} ${att.user.lastName || ""}`.trim();
      const checkIn = new Date(att.checkIn!);

      let breakMinutes = 0;
      if (att.breakStart && att.breakEnd) {
        breakMinutes = Math.floor(
          (att.breakEnd.getTime() - att.breakStart.getTime()) / (1000 * 60)
        );
      }
      const workedMinutes = Math.max(
        0,
        Math.floor((checkoutTime.getTime() - checkIn.getTime()) / (1000 * 60)) - breakMinutes
      );

      // GATE 4 — per-employee minimum worked time floor.
      // Auto-checkout runs after 7 PM PKT. A legitimate employee will always
      // have at least 4h worked. Anyone below that is the signature of a
      // misfire — leave them untouched.
      if (workedMinutes < halfDayThresholdMin) {
        skipped.push({
          employeeId: att.user.id,
          name,
          reason: `workedMinutes=${workedMinutes} below ${halfDayThresholdMin} floor`,
        });
        continue;
      }

      // GATE 5 — math sanity: checkoutTime must be > checkIn + 4h
      const elapsedMs = checkoutTime.getTime() - checkIn.getTime();
      if (elapsedMs < halfDayThresholdMin * 60 * 1000) {
        skipped.push({
          employeeId: att.user.id,
          name,
          reason: `elapsed since checkIn (${Math.floor(elapsedMs / 60000)}m) below ${halfDayThresholdMin}m`,
        });
        continue;
      }

      // SANITY 6 (per-employee) — never write the legacy hardcoded value
      if (
        checkoutTime.getUTCHours() === LEGACY_BUG_HOUR_UTC &&
        checkoutTime.getUTCMinutes() === 0
      ) {
        skipped.push({ employeeId: att.user.id, name, reason: "checkoutTime matches legacy bug signature" });
        continue;
      }

      const resolved = await resolveAttendanceStatus({
        userId: att.user.id,
        date: today,
        workedMinutes,
        lateMinutes: att.lateMinutes,
        currentStatus: att.status,
      });
      const status = resolved.status;

      const earlyLeaveMin = Math.max(0, fullDayMinutes - workedMinutes);
      const overtimeMinutes = Math.max(0, workedMinutes - fullDayMinutes);

      await prisma.attendance.update({
        where: { id: att.id },
        data: {
          checkOut: checkoutTime,
          workedMinutes,
          overtimeMinutes: overtimeMinutes > 0 ? overtimeMinutes : null,
          earlyLeaveMin: earlyLeaveMin > 0 ? earlyLeaveMin : null,
          status,
          notes: `End-of-day auto-checkout (${triggerSource}, route ${ROUTE_VERSION})`,
        },
      });

      // Break-skip fine — single source of truth helper
      const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
      if (admin) {
        await maybeCreateBreakSkipFine({
          userId: att.user.id,
          date: today,
          breakStart: att.breakStart,
          checkIn: att.checkIn,
          checkOut: checkoutTime,
          workedMinutes,
          adminId: admin.id,
        });
      }

      results.push({ name, workedMinutes, status, autoCheckout: true });
    }

    return json({
      mode: "checkout",
      version: ROUTE_VERSION,
      triggerSource,
      ranAt: checkoutTime.toISOString(),
      count: results.length,
      skipped: skipped.length,
      skippedDetails: skipped,
      results,
    });
  } catch (err: any) {
    return error(`${err.message} (route ${ROUTE_VERSION})`);
  }
}
