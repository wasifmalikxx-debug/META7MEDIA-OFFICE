import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { fetchAllProfits } from "@/lib/services/google-sheets.service";

// GET /api/sheets-profit?month=3&year=2026
// Fetches GROSS PROFIT from each Etsy employee's Google Sheet
export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  // CEO + MANAGER (Izaan) sync OFFICE 1's Etsy team. Etsy PARTNERs (Awais,
  // Mubeen) sync their own team. Non-Etsy partner (Zain on FB) and other
  // roles are blocked — Facebook has no Google Sheet bonus model.
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "PARTNER") {
    return error("Forbidden", 403);
  }

  const { searchParams } = new URL(request.url);
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));

  // Resolve which Etsy department the caller is allowed to sync. Pre multi-
  // office this was hardcoded to dept name "Etsy" — that dept no longer
  // exists (renamed to "Etsy - EM"), and partners can't see EM's sheets
  // anyway. Match etsy-analytics scoping exactly so the Sync Profits button
  // on the Bonus Program page works for everyone who can view it.
  let scopedDeptId: string | null = null;

  if (role === "PARTNER") {
    const team = await prisma.team.findFirst({
      where: { partnerId: session.user.id },
      select: { department: { select: { id: true, name: true } } },
    });
    if (!team || !team.department) return error("No team found for this partner", 404);
    if (!team.department.name.toLowerCase().includes("etsy")) {
      // Non-Etsy partner (Zain/FB) — sync doesn't apply.
      return error("Sync is only available for Etsy teams", 403);
    }
    scopedDeptId = team.department.id;
  } else {
    // CEO / MANAGER → primary office's Etsy team (Etsy - EM, with legacy
    // "Etsy" fallback for any old data).
    const dept = await prisma.department.findFirst({
      where: {
        office: { isPrimary: true },
        OR: [{ name: "Etsy - EM" }, { name: "Etsy" }],
      },
      select: { id: true },
    });
    if (!dept) return error("Etsy department not found");
    scopedDeptId = dept.id;
  }

  const employees = await prisma.user.findMany({
    where: {
      departmentId: scopedDeptId,
      status: { in: ["HIRED", "PROBATION"] },
      googleSheetUrl: { not: null },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      googleSheetUrl: true,
    },
  });

  const employeeSheets = employees
    .filter((e) => e.googleSheetUrl)
    .map((e) => ({ userId: e.id, sheetUrl: e.googleSheetUrl! }));

  if (employeeSheets.length === 0) {
    return json({ profits: {}, message: "No employees have Google Sheet URLs configured" });
  }

  const profits = await fetchAllProfits(employeeSheets, month, year);

  return json({
    month,
    year,
    profits,
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      employeeId: e.employeeId,
      hasSheet: !!e.googleSheetUrl,
    })),
  });
}
