import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { EmployeesView } from "@/components/employees/employees-view";

export default async function EmployeesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  const [employees, departments] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        employeeId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
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
      orderBy: { firstName: "asc" },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Employee Management" description="Manage all employees" />
      <EmployeesView
        employees={JSON.parse(JSON.stringify(employees))}
        departments={departments}
      />
    </div>
  );
}
