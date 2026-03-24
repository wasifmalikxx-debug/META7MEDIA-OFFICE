import { NextRequest } from "next/server";
import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { fetchAllProfits } from "@/lib/services/google-sheets.service";

// GET /api/sheets-profit?month=3&year=2026
// Fetches GROSS PROFIT from each Etsy employee's Google Sheet
export async function GET(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN", "MANAGER");
  if (!session) return error("Forbidden", 403);

  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));

  // Get Etsy employees with Google Sheet URLs
  const etsyDept = await prisma.department.findFirst({ where: { name: "Etsy" } });
  if (!etsyDept) return error("Etsy department not found");

  const employees = await prisma.user.findMany({
    where: {
      departmentId: etsyDept.id,
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
