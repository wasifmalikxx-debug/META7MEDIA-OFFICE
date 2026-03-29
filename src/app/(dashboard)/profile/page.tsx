import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BankDetailsCard } from "@/components/profile/bank-details-card";
import { CEOProfileEditor } from "@/components/profile/ceo-profile-editor";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      department: { select: { name: true } },
      salaryStructure: true,
    },
  });

  if (!user) redirect("/login");

  const isCEO = user.role === "SUPER_ADMIN";

  if (isCEO) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Profile" />
        <CEOProfileEditor
          firstName={user.firstName}
          lastName={user.lastName}
          email={user.email}
          phone={user.phone || ""}
          phone2={(user as any).phone2 || ""}
          employeeId={user.employeeId}
          role={user.role}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My Profile" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-sm font-bold">Personal Information</CardTitle>
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
    <div className="flex justify-between items-center text-sm py-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
