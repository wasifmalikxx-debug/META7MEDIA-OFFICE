import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Clock, Calendar, Wallet, AlertTriangle, Gift } from "lucide-react";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && id !== session.user.id) {
    redirect("/dashboard");
  }

  const employee = await prisma.user.findUnique({
    where: { id },
    include: {
      department: { select: { name: true } },
      team: { select: { name: true } },
      manager: { select: { firstName: true, lastName: true } },
      salaryStructure: true,
      leaveBalances: { where: { year: new Date(Date.now() + 5 * 60 * 60_000).getUTCFullYear() } },
    },
  });

  if (!employee) notFound();

  const now = new Date(Date.now() + 5 * 60 * 60_000);
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const [attendances, fines, incentives, payroll] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId: id, date: { gte: startDate, lte: endDate } },
    }),
    prisma.fine.findMany({ where: { userId: id, month, year } }),
    prisma.incentive.findMany({ where: { userId: id, month, year } }),
    prisma.payrollRecord.findFirst({ where: { userId: id, month, year } }),
  ]);

  const present = attendances.filter(
    (a) => a.status === "PRESENT" || a.status === "LATE"
  ).length;
  const absent = attendances.filter((a) => a.status === "ABSENT").length;
  const late = attendances.filter((a) => a.status === "LATE").length;
  const totalFines = fines.reduce((s, f) => s + f.amount, 0);
  const totalIncentives = incentives.reduce((s, i) => s + i.amount, 0);
  const leaveBalance = employee.leaveBalances[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${employee.firstName} ${employee.lastName}`}
        description={`${employee.employeeId} — ${employee.designation || employee.role}`}
      />

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Department</p>
            <p className="font-medium">{employee.department?.name || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Role</p>
            <Badge variant="outline">{employee.role}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Joined</p>
            <p className="font-medium">
              {format(new Date(employee.joiningDate), "MMM d, yyyy")}
            </p>
          </CardContent>
        </Card>
      </div>

      <h3 className="text-lg font-semibold">
        This Month ({format(new Date(), "MMMM yyyy")})
      </h3>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard title="Present" value={present} icon={Clock} />
        <StatCard title="Absent" value={absent} icon={Calendar} />
        <StatCard title="Late" value={late} icon={Clock} />
        <StatCard
          title="Fines"
          value={`PKR ${totalFines.toLocaleString()}`}
          icon={AlertTriangle}
        />
        <StatCard
          title="Incentives"
          value={`PKR ${totalIncentives.toLocaleString()}`}
          icon={Gift}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salary Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow
              label="Monthly Salary"
              value={`PKR ${(employee.salaryStructure?.monthlySalary || 0).toLocaleString()}`}
            />
            {payroll && (
              <>
                <InfoRow
                  label="Earned Salary"
                  value={`PKR ${payroll.earnedSalary.toLocaleString()}`}
                />
                <InfoRow
                  label="Deductions"
                  value={`PKR ${payroll.totalDeductions.toLocaleString()}`}
                />
                <InfoRow
                  label="Net Payable"
                  value={`PKR ${payroll.netSalary.toLocaleString()}`}
                />
                <InfoRow label="Status" value={payroll.status} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leave Balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow
              label="Casual Leave"
              value={`${(leaveBalance?.casualTotal || 12) - (leaveBalance?.casualUsed || 0)} / ${leaveBalance?.casualTotal || 12}`}
            />
            <InfoRow
              label="Sick Leave"
              value={`${(leaveBalance?.sickTotal || 10) - (leaveBalance?.sickUsed || 0)} / ${leaveBalance?.sickTotal || 10}`}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
