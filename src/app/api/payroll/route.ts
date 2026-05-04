import { NextRequest } from "next/server";
import { json, error, requireAuth, getCallerScope } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));

  const scope = await getCallerScope(session);
  if (!scope) return error("Unauthorized", 401);

  const where: any = { month, year };
  if (!scope.isCeo) {
    if (scope.isPartner) {
      // PARTNER sees their team's payrolls only — strict isolation per Wasif's
      // "Mubeen sees only Mubeen's, Awais only Awais's" rule.
      where.user = { officeId: scope.officeId, teamId: { in: [...(scope.teamIds ?? [])] } };
    } else {
      // EMPLOYEE / MANAGER → self only
      where.userId = session.user.id;
    }
  }

  const records = await prisma.payrollRecord.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
          designation: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { user: { firstName: "asc" } },
  });

  return json(records);
}
