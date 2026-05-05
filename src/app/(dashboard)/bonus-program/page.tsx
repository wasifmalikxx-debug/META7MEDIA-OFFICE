import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { BonusProgramView } from "@/components/bonus-program/bonus-program-view";
import { resolveEtsyScope } from "@/lib/etsy-team-scope";

export const dynamic = "force-dynamic";

export default async function BonusProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; team?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "PARTNER") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  // Resolve scope: CEO obeys ?team=em|ae|me (defaults to em), Izaan locked to
  // EM, partners locked to their own team. Returns null when scope is invalid
  // (e.g. Zain on Facebook hitting this page).
  const scope = await resolveEtsyScope(role, session.user.id, params.team);
  if (!scope) redirect("/dashboard");

  const employees = await prisma.user.findMany({
    where: {
      departmentId: scope.departmentId,
      status: { in: ["HIRED", "PROBATION"] },
      ...(scope.employeeIdExclusions.length > 0
        ? { employeeId: { notIn: scope.employeeIdExclusions } }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      status: true,
    },
    orderBy: { employeeId: "asc" },
  });

  const { sortByEmployeeId } = await import("@/lib/utils/sort-employees");
  const sortedEmployees = sortByEmployeeId(employees);
  employees.length = 0;
  employees.push(...sortedEmployees);

  const memberIds = employees.map((e) => e.id);
  const [bonusEligibilities, reviewBonuses] = await Promise.all([
    memberIds.length > 0
      ? prisma.bonusEligibility.findMany({
          where: { month, year, userId: { in: memberIds } },
          include: {
            user: { select: { firstName: true, lastName: true, employeeId: true } },
            updatedBy: { select: { firstName: true, lastName: true } },
          },
        })
      : Promise.resolve([]),
    memberIds.length > 0
      ? prisma.reviewBonus.findMany({
          where: { month, year, status: "APPROVED", userId: { in: memberIds } },
          include: { user: { select: { firstName: true, lastName: true } } },
        })
      : Promise.resolve([]),
  ]);

  const isPartner = role === "PARTNER";
  const pageTitle = `${scope.departmentName} Bonus Program`;
  const description = isPartner
    ? "Manage monthly bonus eligibility for your team"
    : `Manage monthly bonus eligibility for ${scope.departmentName} employees`;

  return (
    <div className="space-y-6">
      <PageHeader title={pageTitle} description={description} />
      <BonusProgramView
        employees={JSON.parse(JSON.stringify(employees))}
        bonusEligibilities={JSON.parse(JSON.stringify(bonusEligibilities))}
        reviewBonuses={JSON.parse(JSON.stringify(reviewBonuses))}
        currentMonth={month}
        currentYear={year}
        userRole={role}
        teamKey={scope.teamKey}
        canToggleProfit={role === "SUPER_ADMIN" || isPartner}
      />
    </div>
  );
}
