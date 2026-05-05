import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { fetchAllProfits } from "@/lib/services/google-sheets.service";
import { resolveEtsyScope } from "@/lib/etsy-team-scope";

// GET /api/sheets-profit?month=3&year=2026&team=em
// Fetches GROSS PROFIT from each Etsy employee's Google Sheet.
// Team param is honored only for SUPER_ADMIN — partners and managers are
// always scoped to their own team regardless of what they pass.
export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "PARTNER") {
    return error("Forbidden", 403);
  }

  const { searchParams } = new URL(request.url);
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));

  const scope = await resolveEtsyScope(role, session.user.id, searchParams.get("team"));
  if (!scope) {
    if (role === "PARTNER") return error("Sync is only available for Etsy teams", 403);
    return error("Etsy department not found");
  }

  const employees = await prisma.user.findMany({
    where: {
      departmentId: scope.departmentId,
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
