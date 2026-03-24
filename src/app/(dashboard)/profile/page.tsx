import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { BankDetailsCard } from "@/components/profile/bank-details-card";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      department: { select: { name: true } },
      team: { select: { name: true } },
      manager: { select: { firstName: true, lastName: true } },
      salaryStructure: true,
    },
  });

  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader title="My Profile" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Employee ID" value={user.employeeId} />
            <InfoRow label="Name" value={`${user.firstName} ${user.lastName}`} />
            <InfoRow label="Email" value={user.email} />
            <InfoRow label="Phone" value={user.phone || "—"} />
            <InfoRow
              label="Role"
              value={<Badge variant="outline">{user.role}</Badge>}
            />
            <InfoRow label="Status" value={user.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Department" value={user.department?.name || "—"} />
            <InfoRow
              label="Joining Date"
              value={format(new Date(user.joiningDate), "MMM d, yyyy")}
            />
            <InfoRow
              label="Monthly Salary"
              value={
                user.salaryStructure
                  ? `PKR ${user.salaryStructure.monthlySalary.toLocaleString()}`
                  : "—"
              }
            />
          </CardContent>
        </Card>
        <BankDetailsCard
          userId={user.id}
          bankName={user.bankName}
          accountNumber={user.accountNumber}
          accountTitle={user.accountTitle}
        />
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
