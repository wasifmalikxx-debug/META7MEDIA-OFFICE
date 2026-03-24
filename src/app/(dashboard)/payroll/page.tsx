import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PayrollView } from "@/components/payroll/payroll-view";

export default async function PayrollPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();

  const where: any = { month, year };
  if (!isAdmin) where.userId = session.user.id;

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description={isAdmin ? "Generate and manage monthly payroll" : "Your salary details"}
      />
      <PayrollView
        records={JSON.parse(JSON.stringify(records))}
        isAdmin={isAdmin}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
