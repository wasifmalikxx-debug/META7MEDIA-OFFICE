import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { BonusProgramView } from "@/components/bonus-program/bonus-program-view";

export const dynamic = "force-dynamic";

export default async function BonusProgramPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  // CEO + MANAGER (Izaan) + Etsy PARTNERs (Awais, Mubeen) all access this page,
  // each scoped to their own Etsy team.
  if (role !== "SUPER_ADMIN" && role !== "MANAGER" && role !== "PARTNER") {
    redirect("/dashboard");
  }
  const isPartner = role === "PARTNER";

  const params = await searchParams;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

  // Resolve which department + employees this viewer manages.
  //
  // CEO / MANAGER → OFFICE 1's "Etsy - EM" department (excluding Izaan as team
  //                  lead and EM-4L who's on non-Etsy ecom work).
  // PARTNER       → their own Etsy department (Etsy - AE for Awais, Etsy - ME
  //                  for Mubeen). No employee exclusions — AE/ME teams don't
  //                  have a team-lead employee since the partner isn't on the team.
  let departmentId: string | null = null;
  let employeeIdExclusions: string[] = [];
  let pageTitle = "E-Commerce Bonus Program";

  if (isPartner) {
    const myTeam = await prisma.team.findFirst({
      where: { partnerId: session.user.id },
      select: {
        name: true,
        department: { select: { id: true, name: true } },
      },
    });
    if (!myTeam || !myTeam.department) {
      // PARTNER without an Etsy team (e.g. Zain on Facebook) — bonus program
      // doesn't apply. Send them home.
      redirect("/dashboard");
    }
    // Only Etsy-style departments use the bonus program. If a PARTNER's
    // department isn't Etsy-flavored, redirect them out.
    if (!myTeam.department.name.toLowerCase().includes("etsy")) {
      redirect("/dashboard");
    }
    departmentId = myTeam.department.id;
    pageTitle = `${myTeam.department.name} Bonus Program`;
  } else {
    // CEO / MANAGER — primary office Etsy team. Match either "Etsy - EM" (post
    // Phase 6 rename) or legacy "Etsy" so old data still works.
    const etsyDept = await prisma.department.findFirst({
      where: {
        office: { isPrimary: true },
        OR: [{ name: "Etsy - EM" }, { name: "Etsy" }],
      },
    });
    departmentId = etsyDept?.id ?? null;
    // OFFICE 1-specific exclusions: Izaan (team lead) and EM-4L (non-Etsy ecom).
    employeeIdExclusions = ["EM-4", "EM-4L"];
  }

  const employees = departmentId
    ? await prisma.user.findMany({
        where: {
          departmentId,
          status: { in: ["HIRED", "PROBATION"] },
          ...(employeeIdExclusions.length > 0
            ? { employeeId: { notIn: employeeIdExclusions } }
            : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeId: true,
        },
        orderBy: { employeeId: "asc" },
      })
    : [];

  const { sortByEmployeeId } = await import("@/lib/utils/sort-employees");
  const sortedEmployees = sortByEmployeeId(employees);
  employees.length = 0;
  employees.push(...sortedEmployees);

  // Bonus eligibility + review bonuses, scoped to this department's employees.
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={pageTitle}
        description={
          isPartner
            ? "Manage monthly bonus eligibility for your team"
            : "Manage monthly bonus eligibility for Etsy department employees"
        }
      />
      <BonusProgramView
        employees={JSON.parse(JSON.stringify(employees))}
        bonusEligibilities={JSON.parse(JSON.stringify(bonusEligibilities))}
        reviewBonuses={JSON.parse(JSON.stringify(reviewBonuses))}
        currentMonth={month}
        currentYear={year}
        userRole={role}
        canToggleProfit={role === "SUPER_ADMIN" || isPartner}
      />
    </div>
  );
}
