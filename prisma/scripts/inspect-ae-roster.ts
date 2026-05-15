/**
 * Quick roster check — lists every employee whose ID starts with AE- and
 * shows status + department + whether they have a sheet wired up. Used
 * to confirm whether someone is being legitimately excluded from the
 * analytics audit (e.g., moved off the AE team) or wrongly missed.
 */
import { prisma } from "../../src/lib/prisma";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

(async () => {
  // Mirror the audit script's exact Prisma query so we see who it would
  // include vs the raw AE roster.
  const auditMatched = await prisma.user.findMany({
    where: {
      status: { in: ["HIRED", "PROBATION"] },
      googleSheetUrl: { not: null },
      department: { name: { in: ["Etsy - EM", "Etsy - AE", "Etsy - ME"] } },
    },
    select: {
      employeeId: true,
      firstName: true,
      lastName: true,
      status: true,
      department: { select: { name: true } },
      team: { select: { name: true } },
    },
    orderBy: [{ department: { name: "asc" } }, { employeeId: "asc" }],
  });
  const aeOnly = auditMatched.filter((u) => u.department?.name === "Etsy - AE");
  console.log(`\nAudit query matched ${auditMatched.length} total · ${aeOnly.length} on AE team:\n`);
  for (const u of aeOnly) {
    console.log(
      `  ${u.employeeId.padEnd(6)} ${`${u.firstName} ${u.lastName ?? ""}`.trim().padEnd(22)} ` +
        `status=${u.status.padEnd(10)} dept=${(u.department?.name ?? "—").padEnd(14)} ` +
        `team=${u.team?.name ?? "—"}`,
    );
  }

  // Also list every AE-prefixed user regardless of filter so we can see
  // who's being excluded and why.
  const allAE = await prisma.user.findMany({
    where: { employeeId: { startsWith: "AE-" } },
    select: {
      employeeId: true,
      firstName: true,
      lastName: true,
      status: true,
      department: { select: { name: true } },
      googleSheetUrl: true,
    },
    orderBy: { employeeId: "asc" },
  });
  console.log(`\nAll AE-prefixed users (${allAE.length}):\n`);
  for (const u of allAE) {
    const wouldMatch =
      (u.status === "HIRED" || u.status === "PROBATION") &&
      !!u.googleSheetUrl &&
      u.department?.name === "Etsy - AE";
    console.log(
      `  ${wouldMatch ? "✓" : "✗"} ${u.employeeId.padEnd(6)} ${`${u.firstName} ${u.lastName ?? ""}`.trim().padEnd(22)} ` +
        `status=${u.status.padEnd(10)} dept=${(u.department?.name ?? "—").padEnd(14)} sheet=${u.googleSheetUrl ? "yes" : "NO"}`,
    );
  }
  await prisma.$disconnect();
})();
