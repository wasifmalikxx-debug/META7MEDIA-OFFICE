import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { EmployeesView } from "@/components/employees/employees-view";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  // Partners also access this page — scoped to their team(s) below.
  if (role !== "SUPER_ADMIN" && role !== "PARTNER") {
    redirect("/dashboard");
  }
  const isPartner = role === "PARTNER";

  // Resolve PARTNER's scope: which teams + which department(s) they own.
  let partnerScope: { teamIds: string[]; deptIds: string[]; officeId: string | null } | null = null;
  if (isPartner) {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        officeId: true,
        partnerTeams: {
          select: { id: true, departmentId: true },
        },
      },
    });
    partnerScope = {
      teamIds: me?.partnerTeams.map((t) => t.id) ?? [],
      deptIds: [...new Set(me?.partnerTeams.map((t) => t.departmentId) ?? [])],
      officeId: me?.officeId ?? null,
    };
  }

  // Employee list scope:
  //   CEO     → all non-SUPER_ADMIN users (existing behavior, includes partners)
  //   PARTNER → only employees on one of the teams they manage
  const empWhere: any = isPartner
    ? {
        teamId:
          partnerScope!.teamIds.length > 0 ? { in: partnerScope!.teamIds } : "__none__",
      }
    : { role: { not: "SUPER_ADMIN" } };

  // Department list scope (drives the "Add Employee" form's dropdown):
  //   CEO     → all departments across both offices
  //   PARTNER → only departments where they own a team
  //             (e.g. Zain → Facebook only, not Etsy-AE/ME/Partners)
  const deptWhere: any = isPartner
    ? { id: partnerScope!.deptIds.length > 0 ? { in: partnerScope!.deptIds } : "__none__" }
    : {};

  const [employees, departments] = await Promise.all([
    prisma.user
      .findMany({
        where: empWhere,
        select: {
          id: true,
          employeeId: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          phone2: true,
          role: true,
          status: true,
          designation: true,
          joiningDate: true,
          bankName: true,
          accountNumber: true,
          accountTitle: true,
          department: { select: { id: true, name: true } },
          salaryStructure: { select: { monthlySalary: true } },
        },
        orderBy: { employeeId: "asc" },
      })
      .then(async (emps) => {
        const { sortByEmployeeId } = await import("@/lib/utils/sort-employees");
        return sortByEmployeeId(emps);
      }),
    prisma.department.findMany({ where: deptWhere, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Management"
        description={isPartner ? "Manage your team's employees" : "Manage all employees"}
      />
      <EmployeesView
        employees={JSON.parse(JSON.stringify(employees))}
        departments={departments}
        isCeo={!isPartner}
      />
    </div>
  );
}
