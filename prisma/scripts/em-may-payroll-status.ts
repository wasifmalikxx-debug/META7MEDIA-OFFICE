import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const em = await p.user.findMany({
    where: { department: { name: "Etsy - EM" }, status: { in: ["HIRED","PROBATION"] } },
    select: { id:true, employeeId:true, firstName:true, lastName:true },
    orderBy: { employeeId: "asc" },
  });
  console.log("EM TEAM — MAY 2026 PAYROLL");
  console.log("=".repeat(120));
  console.log(
    "Emp".padEnd(6)+" | "+"Name".padEnd(18)+" | "+"Status".padEnd(6)+" | "+
    "Salary".padStart(8)+" | "+"Bonus".padStart(8)+" | "+"Deduct".padStart(9)+" | "+
    "FINAL PAY".padStart(10)+" | Consistency"
  );
  console.log("-".repeat(120));
  let pendTotal = 0, paidTotal = 0;
  for (const u of em) {
    const r = await p.payrollRecord.findUnique({ where: { userId_month_year: { userId: u.id, month:5, year:2026 } } });
    const name = (u.firstName+" "+(u.lastName||"")).trim();
    if (!r) { console.log(`${(u.employeeId||"").padEnd(6)} | ${name.padEnd(18).slice(0,18)} | ${"NONE".padEnd(6)} | no payroll record`); continue; }
    // consistency: netSalary should == earnedSalary + totalIncentives - totalDeductions
    const expected = Math.round((r.earnedSalary + r.totalIncentives - r.totalDeductions)*100)/100;
    const ok = Math.abs(expected - r.netSalary) < 1 ? "OK" : `MISMATCH (calc ${expected})`;
    const negFlag = r.netSalary < 0 ? "  ⚠ NEGATIVE" : "";
    console.log(
      `${(u.employeeId||"").padEnd(6)} | ${name.padEnd(18).slice(0,18)} | ${r.status.padEnd(6)} | `+
      `${Math.round(r.monthlySalary).toLocaleString().padStart(8)} | ${Math.round(r.totalIncentives).toLocaleString().padStart(8)} | `+
      `${Math.round(r.totalDeductions).toLocaleString().padStart(9)} | ${Math.round(r.netSalary).toLocaleString().padStart(10)} | ${ok}${negFlag}`
    );
    if (r.status === "PAID") paidTotal += r.netSalary; else pendTotal += r.netSalary;
  }
  console.log("-".repeat(120));
  console.log(`PENDING (to pay): PKR ${Math.round(pendTotal).toLocaleString()}   |   ALREADY PAID: PKR ${Math.round(paidTotal).toLocaleString()}`);
  console.log("\nNote: 'Deduct' includes advance-salary clawbacks + fines. 'FINAL PAY' = what lands in their account.");
}
main().finally(()=>p.$disconnect());
