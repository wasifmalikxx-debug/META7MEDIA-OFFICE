import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { BonusProgramView } from "@/components/bonus-program/bonus-program-view";

export default async function BonusProgramPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
    redirect("/dashboard");
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Find the Etsy department
  const etsyDept = await prisma.department.findUnique({
    where: { name: "Etsy" },
  });

  // Fetch Etsy employees
  const employees = etsyDept
    ? await prisma.user.findMany({
        where: {
          departmentId: etsyDept.id,
          status: { in: ["HIRED", "PROBATION"] },
          employeeId: { not: "EM-4" }, // Exclude team lead Izaan
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

  // Sort by employee ID: EM-1, EM-2, ..., EM-10, EM-4 (Manager last)
  const { sortByEmployeeId } = await import("@/lib/utils/sort-employees");
  const sortedEmployees = sortByEmployeeId(employees);
  employees.length = 0;
  employees.push(...sortedEmployees);

  // Fetch bonus eligibilities for the current month
  const bonusEligibilities = await prisma.bonusEligibility.findMany({
    where: { month, year },
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      updatedBy: { select: { firstName: true, lastName: true } },
    },
  });

  // Fetch review bonuses for the current month
  const reviewBonuses = await prisma.reviewBonus.findMany({
    where: { month, year, status: "APPROVED" },
    include: {
      user: { select: { firstName: true, lastName: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="E-Commerce Bonus Program"
        description="Manage monthly bonus eligibility for Etsy department employees"
      />
      <BonusProgramView
        employees={JSON.parse(JSON.stringify(employees))}
        bonusEligibilities={JSON.parse(JSON.stringify(bonusEligibilities))}
        reviewBonuses={JSON.parse(JSON.stringify(reviewBonuses))}
        currentMonth={month}
        currentYear={year}
        userRole={role}
      />
    </div>
  );
}
