import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PayrollView } from "@/components/payroll/payroll-view";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const month = params.month ? parseInt(params.month) : new Date().getMonth() + 1;
  const year = params.year ? parseInt(params.year) : new Date().getFullYear();

  const where: any = { month, year };
  if (!isAdmin) {
    where.userId = session.user.id;
  } else {
    where.user = { role: { not: "SUPER_ADMIN" } };
  }

  const records = await prisma.payrollRecord.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
          status: true,
          designation: true,
          bankName: true,
          accountNumber: true,
          accountTitle: true,
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
