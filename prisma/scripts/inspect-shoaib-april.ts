/**
 * Diagnostic: SMM-10 (Muhammad Shoaib) April 2026 payroll breakdown.
 * The list view shows Salary 50,000 - Fine 200 = 49,800 but Final Salary
 * 48,133.43, so something else is subtracting ~1,667 (= one day's pro-rated
 * salary). Pull every April record on this user so we can pinpoint it.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const u = await prisma.user.findFirst({
    where: { employeeId: "SMM-10" },
    include: {
      salaryStructure: true,
      department: { select: { name: true } },
      team: { select: { name: true } },
    },
  });
  if (!u) {
    console.log("SMM-10 not found");
    return;
  }

  console.log(`USER: ${u.firstName} ${u.lastName || ""} (${u.employeeId})`);
  console.log(`  team:        ${u.team?.name || "—"}`);
  console.log(`  department:  ${u.department?.name || "—"}`);
  console.log(`  status:      ${u.status}`);
  console.log(`  joiningDate: ${u.joiningDate?.toISOString().slice(0, 10)}`);
  console.log(`  salary:      Rs ${u.salaryStructure?.monthlySalary?.toLocaleString() || "—"}/month`);
  console.log("");

  const aprStart = new Date(Date.UTC(2026, 3, 1));
  const aprEnd = new Date(Date.UTC(2026, 3, 30, 23, 59, 59));

  const payroll = await prisma.payrollRecord.findUnique({
    where: { userId_month_year: { userId: u.id, month: 4, year: 2026 } },
  });
  console.log("=== APRIL 2026 PAYROLL RECORD ===");
  if (!payroll) {
    console.log("  (no record)");
  } else {
    console.log(`  monthlySalary:     ${payroll.monthlySalary}`);
    console.log(`  daysInMonth:       ${(payroll as any).daysInMonth ?? "—"}`);
    console.log(`  daysWorked:        ${(payroll as any).daysWorked ?? "—"}`);
    console.log(`  daysAbsent:        ${(payroll as any).daysAbsent ?? "—"}`);
    console.log(`  daysOnLeave:       ${(payroll as any).daysOnLeave ?? "—"}`);
    console.log(`  paidLeaveDays:     ${(payroll as any).paidLeaveDays ?? "—"}`);
    console.log(`  unpaidLeaveDays:   ${(payroll as any).unpaidLeaveDays ?? "—"}`);
    console.log(`  totalFines:        ${payroll.totalFines}`);
    console.log(`  totalIncentives:   ${payroll.totalIncentives}`);
    console.log(`  grossSalary:       ${(payroll as any).grossSalary ?? "—"}`);
    console.log(`  netSalary:         ${payroll.netSalary}`);
    console.log(`  status:            ${payroll.status}`);
    console.log(`  paidAt:            ${payroll.paidAt?.toISOString() || "—"}`);
  }
  console.log("");

  const fines = await prisma.fine.findMany({
    where: { userId: u.id, date: { gte: aprStart, lte: aprEnd } },
    orderBy: { date: "asc" },
  });
  console.log(`=== APRIL 2026 FINES (${fines.length}) ===`);
  for (const f of fines) {
    console.log(`  ${f.date.toISOString().slice(0, 10)}  Rs${f.amount}  type=${f.type}  reason=${f.reason}`);
  }
  console.log("");

  const attendance = await prisma.attendance.findMany({
    where: { userId: u.id, date: { gte: aprStart, lte: aprEnd } },
    orderBy: { date: "asc" },
  });
  console.log(`=== APRIL 2026 ATTENDANCE (${attendance.length} days) ===`);
  for (const a of attendance) {
    const date = a.date.toISOString().slice(0, 10);
    const inT = a.checkIn ? a.checkIn.toISOString().slice(11, 16) : "—";
    const outT = a.checkOut ? a.checkOut.toISOString().slice(11, 16) : "—";
    const lateMin = (a as any).lateMinutes ?? 0;
    const worked = (a as any).workedMinutes ?? 0;
    console.log(`  ${date}  status=${a.status}  in=${inT}  out=${outT}  late=${lateMin}m  worked=${worked}m`);
  }
  console.log("");

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId: u.id,
      OR: [
        { startDate: { gte: aprStart, lte: aprEnd } },
        { endDate: { gte: aprStart, lte: aprEnd } },
      ],
    },
    orderBy: { startDate: "asc" },
  });
  console.log(`=== APRIL 2026 LEAVE REQUESTS (${leaves.length}) ===`);
  for (const l of leaves) {
    const s = l.startDate.toISOString().slice(0, 10);
    const e = l.endDate.toISOString().slice(0, 10);
    console.log(`  ${s} → ${e}  type=${l.leaveType}  status=${l.status}  reason=${l.reason || "—"}`);
  }
  console.log("");

  // Math check
  if (payroll && u.salaryStructure?.monthlySalary) {
    const salary = u.salaryStructure.monthlySalary;
    const expected = salary - payroll.totalFines + payroll.totalIncentives;
    console.log("=== MATH CHECK ===");
    console.log(`  Salary:        Rs ${salary.toLocaleString()}`);
    console.log(`  - Fines:       Rs ${payroll.totalFines}`);
    console.log(`  + Incentives:  Rs ${payroll.totalIncentives}`);
    console.log(`  = Expected:    Rs ${expected.toLocaleString()}`);
    console.log(`  Actual net:    Rs ${payroll.netSalary.toLocaleString()}`);
    const diff = expected - payroll.netSalary;
    console.log(`  DIFF:          Rs ${diff.toFixed(2)}  (≈ ${(diff / (salary / 30)).toFixed(2)} day(s) of salary)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
