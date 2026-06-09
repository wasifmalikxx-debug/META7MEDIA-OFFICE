import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const may30 = new Date(Date.UTC(2026, 4, 30));
  const fines = await p.fine.findMany({
    where: { date: may30, type: "ABSENT_WITHOUT_LEAVE", amount: { gt: 0 } },
    include: { user: { select: { id: true, employeeId: true, firstName: true, lastName: true } } },
  });
  let draftTotal = 0, paidTotal = 0;
  const draft: string[] = [], paid: string[] = [];
  for (const f of fines) {
    const rec = await p.payrollRecord.findUnique({ where: { userId_month_year: { userId: f.user.id, month: 5, year: 2026 } } });
    const reflected = rec ? rec.updatedAt.getTime() >= f.createdAt.getTime() : false;
    const line = `  ${f.user.employeeId.padEnd(7)} ${(f.user.firstName+" "+(f.user.lastName||"")).trim().padEnd(22)} PKR ${String(f.amount).padStart(8)}  ${reflected?"already in":"MISSING from"} payroll`;
    if (rec?.status === "PAID") { paid.push(line); paidTotal += f.amount; }
    else { draft.push(line); draftTotal += f.amount; }
  }
  console.log("NOT-CLEARED (DRAFT) — May 30 absent fines vs payroll:");
  draft.forEach(l => console.log(l));
  console.log(`  ${"".padEnd(7)} ${"TOTAL".padEnd(22)} PKR ${String(draftTotal).padStart(8)}`);
  console.log("");
  console.log("ALREADY PAID (frozen) — May 30 absent fines:");
  paid.forEach(l => console.log(l));
  console.log(`  ${"".padEnd(7)} ${"TOTAL".padEnd(22)} PKR ${String(paidTotal).padStart(8)}`);
}
main().catch(console.error).finally(()=>p.$disconnect());
