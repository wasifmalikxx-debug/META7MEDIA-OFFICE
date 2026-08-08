/**
 * APPLY — EM-5 Muhammad Shoaibb new-hire June reset (CEO-confirmed 2026-06-15).
 *   - Real start = June 11 (joiningDate already June 11 — no change).
 *   - June 1-10 attendance = stray (pre-join) -> DELETE.
 *   - Post-join ON_LEAVE (Jun 11/12/13/15) -> set PRESENT (paid).
 *   - April/May fines -> LEFT UNTOUCHED (per CEO). June fines already 0.
 *   - Recompute June payroll via canonical generator -> pro-rated ~Rs 20,000.
 * Targets PROD (./.env, never .env.local). Scoped strictly to EM-5.
 */
import { readFileSync } from "fs";

function prodUrl(): string {
  const raw = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
  if (!m) throw new Error("No DATABASE_URL in .env");
  let url = m[1];
  if (url.includes("meta7media_office_dev")) throw new Error("Refusing: that's the DEV db");
  url = url.includes("connection_limit=")
    ? url.replace(/connection_limit=\d+/, "connection_limit=1")
    : url + (url.includes("?") ? "&" : "?") + "connection_limit=1";
  return url;
}

const MONTH = 6, YEAR = 2026;
const start = new Date(Date.UTC(YEAR, 5, 1));        // Jun 1
const join = new Date(Date.UTC(YEAR, 5, 11));       // Jun 11 (00:00)
const end = new Date(Date.UTC(YEAR, 5, 30, 23, 59, 59));

async function main() {
  process.env.DATABASE_URL = prodUrl();
  console.log("DB target (prod):", process.env.DATABASE_URL.replace(/\/\/[^@]*@/, "//USER:PASS@").replace(/@([^/:]+).*/, "@$1…"), "\n");
  const { prisma } = await import("../../src/lib/prisma");
  const { syncPayrollRecord } = await import("../../src/lib/services/payroll-sync.service");

  const u = await prisma.user.findFirst({
    where: { employeeId: "EM-5" },
    include: { department: { select: { name: true } } },
  });
  if (!u) { console.log("EM-5 not found"); await prisma.$disconnect(); return; }
  const fullName = `${u.firstName} ${u.lastName || ""}`.trim();
  console.log(`USER: ${fullName} (${u.employeeId}) — ${u.department?.name} — joiningDate ${u.joiningDate?.toISOString().slice(0,10)} — ${u.status}`);

  // --- SAFETY GUARDS (never touch the wrong person) ---
  if (u.employeeId !== "EM-5") { console.log("ABORT: not EM-5"); await prisma.$disconnect(); return; }
  if (!/shoaib/i.test(fullName)) { console.log("ABORT: name is not Shoaibb:", fullName); await prisma.$disconnect(); return; }
  if (u.department?.name && !/EM/.test(u.department.name)) { console.log("ABORT: not EM dept:", u.department?.name); await prisma.$disconnect(); return; }

  async function dump(label: string) {
    const att = await prisma.attendance.findMany({ where: { userId: u!.id, date: { gte: start, lte: end } }, orderBy: { date: "asc" } });
    const by: Record<string, number> = {};
    for (const a of att) by[a.status] = (by[a.status] || 0) + 1;
    const pr = await prisma.payrollRecord.findUnique({ where: { userId_month_year: { userId: u!.id, month: MONTH, year: YEAR } } });
    const fJune = await prisma.fine.count({ where: { userId: u!.id, month: MONTH, year: YEAR } });
    const fAll = await prisma.fine.count({ where: { userId: u!.id } });
    console.log(`\n──── ${label} ────`);
    console.log(`  June attendance: ${att.length} rows ${JSON.stringify(by)}`);
    console.log(`    ${att.map(a => `${a.date.toISOString().slice(5,10)}:${a.status}`).join("  ")}`);
    console.log(`  June payroll: net=Rs ${pr?.netSalary ?? "—"}  earned=${(pr as any)?.earnedSalary ?? "—"}  absentDays=${(pr as any)?.absentDays ?? "—"}  unpaidLeaveDays=${(pr as any)?.unpaidLeaveDays ?? "—"}  totalFines=${pr?.totalFines ?? "—"}  status=${pr?.status ?? "—"}`);
    console.log(`  Fines: June=${fJune}  all-time=${fAll}  (April/May intentionally untouched)`);
  }

  await dump("BEFORE");

  // --- MUTATE (batched transaction over pooler) ---
  const [del, upd] = await prisma.$transaction([
    prisma.attendance.deleteMany({ where: { userId: u.id, date: { gte: start, lt: join } } }),
    prisma.attendance.updateMany({ where: { userId: u.id, date: { gte: join, lte: end }, status: "ON_LEAVE" }, data: { status: "PRESENT" } }),
  ]);
  console.log(`\nMUTATED: deleted ${del.count} pre-join (Jun 1-10) attendance rows; cleared ${upd.count} post-join ON_LEAVE → PRESENT`);

  // --- recompute June payroll via canonical generator ---
  await syncPayrollRecord(u.id, MONTH, YEAR);
  console.log("Recomputed June payroll (syncPayrollRecord → generatePayrollForEmployee)");

  await dump("AFTER");

  const finalPr = await prisma.payrollRecord.findUnique({ where: { userId_month_year: { userId: u.id, month: MONTH, year: YEAR } } });
  const net = finalPr?.netSalary ?? -1;
  console.log(net >= 19000 && net <= 21000
    ? `\n✅ June net = Rs ${net.toLocaleString()} (pro-rated from June 11 — as expected).`
    : `\n⚠️ June net = Rs ${net} — NOT in the expected ~20,000 range. Review before telling the CEO it's done.`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
