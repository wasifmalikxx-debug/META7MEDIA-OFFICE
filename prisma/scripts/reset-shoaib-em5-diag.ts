/**
 * READ-ONLY diagnostic — EM-5 Muhammad Shaoibb (Etsy team), June 2026.
 * Shows everything that would be reset for a clean new-hire start.
 * Targets PROD explicitly (parses ./.env, NOT .env.local). Makes NO writes.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

// --- resolve PROD url from .env (never the dev DB) ---
const envRaw = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const m = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) { console.error("No DATABASE_URL in .env"); process.exit(1); }
let url = m[1];
if (url.includes("meta7media_office_dev")) { console.error("Refusing: that's the DEV db"); process.exit(1); }
url = url.includes("connection_limit=")
  ? url.replace(/connection_limit=\d+/, "connection_limit=1")
  : url + (url.includes("?") ? "&" : "?") + "connection_limit=1";
const host = url.replace(/\/\/[^@]*@/, "//USER:PASS@").replace(/@([^/:]+).*/, "@$1…");
console.log("DB target (prod):", host, "\n");

const prisma = new PrismaClient({ datasources: { db: { url } } });
const MONTH = 6, YEAR = 2026;
const start = new Date(Date.UTC(YEAR, MONTH - 1, 1));
const end = new Date(Date.UTC(YEAR, MONTH - 1, 30, 23, 59, 59));

async function main() {
  const u = await prisma.user.findFirst({
    where: { employeeId: "EM-5" },
    include: {
      salaryStructure: true,
      department: { select: { name: true } },
      team: { select: { name: true } },
    },
  });
  if (!u) { console.log("EM-5 not found"); return; }

  console.log("=== USER (EM-5) ===");
  console.log(`  name:        ${u.firstName} ${u.lastName || ""}`);
  console.log(`  employeeId:  ${u.employeeId}`);
  console.log(`  team:        ${u.team?.name || "—"}`);
  console.log(`  department:  ${u.department?.name || "—"}`);
  console.log(`  status:      ${u.status}`);
  console.log(`  joiningDate: ${u.joiningDate ? u.joiningDate.toISOString().slice(0, 10) : "— (NOT SET)"}`);
  console.log(`  salary:      Rs ${u.salaryStructure?.monthlySalary?.toLocaleString() || "—"}/month`);
  console.log(`  userId:      ${u.id}`);

  // guard: confirm this is NOT the SMM-10 person
  if (u.employeeId !== "EM-5") { console.log("\nABORT: not EM-5"); return; }

  const finesAll = await prisma.fine.findMany({ where: { userId: u.id }, orderBy: { date: "asc" } });
  const finesJun = finesAll.filter((f) => f.month === MONTH && f.year === YEAR);
  console.log(`\n=== FINES — June (${finesJun.length}) | all-time (${finesAll.length}) ===`);
  for (const f of finesJun) console.log(`  ${f.date.toISOString().slice(0,10)}  Rs${f.amount}  ${f.type}  ${f.reason}`);
  const otherFines = finesAll.filter((f) => !(f.month === MONTH && f.year === YEAR));
  if (otherFines.length) console.log(`  (+${otherFines.length} fine(s) in OTHER months: ${[...new Set(otherFines.map(f=>`${f.month}/${f.year}`))].join(", ")})`);

  const att = await prisma.attendance.findMany({ where: { userId: u.id, date: { gte: start, lte: end } }, orderBy: { date: "asc" } });
  const byStatus: Record<string, number> = {};
  for (const a of att) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  console.log(`\n=== ATTENDANCE — June (${att.length} rows) ===  ${JSON.stringify(byStatus)}`);
  for (const a of att) console.log(`  ${a.date.toISOString().slice(0,10)}  ${a.status}  in=${a.checkIn?a.checkIn.toISOString().slice(11,16):"—"} out=${a.checkOut?a.checkOut.toISOString().slice(11,16):"—"}`);

  const leaves = await prisma.leaveRequest.findMany({
    where: { userId: u.id, OR: [ { startDate: { gte: start, lte: end } }, { endDate: { gte: start, lte: end } } ] },
    orderBy: { startDate: "asc" },
  });
  console.log(`\n=== LEAVE REQUESTS — June (${leaves.length}) ===`);
  for (const l of leaves) console.log(`  ${l.startDate.toISOString().slice(0,10)} → ${l.endDate.toISOString().slice(0,10)}  ${l.leaveType}  ${l.status}  ${l.reason||"—"}`);

  const pr = await prisma.payrollRecord.findUnique({ where: { userId_month_year: { userId: u.id, month: MONTH, year: YEAR } } });
  console.log(`\n=== PAYROLL — June ${YEAR} ===`);
  if (!pr) console.log("  (no June payroll record yet)");
  else console.log(`  totalFines=${pr.totalFines}  daysAbsent=${(pr as any).daysAbsent ?? "—"}  daysOnLeave=${(pr as any).daysOnLeave ?? "—"}  netSalary=${pr.netSalary}  status=${pr.status}  paidAt=${pr.paidAt?.toISOString()||"—"}`);

  console.log("\n(READ-ONLY — nothing was changed.)");
}
main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); return prisma.$disconnect().finally(() => process.exit(1)); });
