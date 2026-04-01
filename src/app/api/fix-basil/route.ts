import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { todayPKT, nowPKT } from "@/lib/pkt";

// One-time fix for Muhammad Basil (SMM-4):
// 1. Force checkout his current session
// 2. Fix his April 1st absent record back to ABSENT (was overridden by late check-in)
// 3. Update the covered leave fine reason to show correct balance
// DELETE THIS FILE after running
export async function POST() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const basil = await prisma.user.findFirst({
    where: { employeeId: "SMM-4" },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!basil) return error("Basil not found");

  const today = todayPKT();
  const now = nowPKT();
  const results: string[] = [];

  // 1. Force checkout today's attendance
  const todayAtt = await prisma.attendance.findUnique({
    where: { userId_date: { userId: basil.id, date: today } },
  });
  if (todayAtt && !todayAtt.checkOut) {
    await prisma.attendance.update({
      where: { id: todayAtt.id },
      data: {
        checkOut: now,
        status: "ABSENT",
        workedMinutes: 0,
        notes: "Force checkout — checked in after office hours (invalid)",
      },
    });
    results.push("Force checked out and marked as ABSENT for today");
  }

  // 2. Fix April 1st record — find his attendance for April 1
  const april1 = new Date(Date.UTC(2026, 3, 1)); // April 1, 2026
  const april1Att = await prisma.attendance.findUnique({
    where: { userId_date: { userId: basil.id, date: april1 } },
  });
  if (april1Att && april1Att.status !== "ABSENT") {
    await prisma.attendance.update({
      where: { id: april1Att.id },
      data: { status: "ABSENT", checkIn: null, checkOut: null, workedMinutes: null, lateMinutes: null },
    });
    results.push("April 1st restored to ABSENT");
  }

  // 3. Fix the covered leave fine reason (update 2.0 to 1.0)
  const coveredFine = await prisma.fine.findFirst({
    where: {
      userId: basil.id,
      amount: 0,
      reason: { contains: "Covered by paid leave" },
      date: april1,
    },
  });
  if (coveredFine) {
    await prisma.fine.update({
      where: { id: coveredFine.id },
      data: { reason: "Absent on 2026-04-01 — Covered by paid leave (1.0 days remaining)" },
    });
    results.push("Updated covered leave fine to show 1.0 balance");
  }

  // 4. Delete the late fine from his invalid check-in
  const lateFine = await prisma.fine.findFirst({
    where: {
      userId: basil.id,
      type: "LATE_ARRIVAL",
      date: april1,
    },
  });
  if (lateFine) {
    await prisma.fine.delete({ where: { id: lateFine.id } });
    results.push("Deleted invalid late arrival fine (PKR " + lateFine.amount + ")");
  }

  return json({ message: "Basil fixed", results });
}
