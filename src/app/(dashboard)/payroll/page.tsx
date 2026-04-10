import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PayrollView } from "@/components/payroll/payroll-view";
import { generatePayrollForEmployee, generatePayrollForAll } from "@/lib/services/payroll.service";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();
  const currentMonth = _pkt.getUTCMonth() + 1;
  const currentYear = _pkt.getUTCFullYear();

  // AUTO-REGENERATE payroll on view so stored records always match the latest
  // calculation logic. Without this, a change to payroll.service.ts leaves
  // stored records stale — exactly what caused Rana Hamza's covered absence
  // to keep showing as a fine after the fine-exclusion fix shipped.
  //
  // Only regenerate for:
  //  1. The current month (past months should be locked / immutable)
  //  2. Records not already marked PAID (don't overwrite a paid record)
  const isCurrentMonth = month === currentMonth && year === currentYear;
  if (isCurrentMonth) {
    try {
      if (isAdmin) {
        await generatePayrollForAll(month, year, session.user.id);
      } else {
        // Only regenerate the employee's own record (if it's not already PAID)
        const existing = await prisma.payrollRecord.findUnique({
          where: { userId_month_year: { userId: session.user.id, month, year } },
          select: { status: true },
        });
        if (!existing || existing.status !== "PAID") {
          await generatePayrollForEmployee(session.user.id, month, year, session.user.id).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("[payroll] auto-regen failed, serving stale data:", e);
    }
  }

  // Only show employees who joined ON or BEFORE the last day of the payroll month
  const payrollMonthEnd = new Date(Date.UTC(year, month, 0)); // last day of month

  const where: any = {
    month,
    year,
    user: {
      joiningDate: { lte: payrollMonthEnd },
      status: { not: "RESIGNED" },
    },
  };
  if (!isAdmin) {
    where.userId = session.user.id;
  } else {
    where.user.role = { not: "SUPER_ADMIN" };
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
