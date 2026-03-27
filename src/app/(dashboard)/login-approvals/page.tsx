import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { LoginApprovalsView } from "@/components/login-approvals/login-approvals-view";

export const dynamic = "force-dynamic";

export default async function LoginApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if ((session.user as any).role !== "SUPER_ADMIN") redirect("/dashboard");

  const devices = await prisma.deviceApproval.findMany({
    include: {
      user: {
        select: { firstName: true, lastName: true, employeeId: true, email: true },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Login Approvals"
        description="Approve or reject employee device login requests"
      />
      <LoginApprovalsView devices={JSON.parse(JSON.stringify(devices))} />
    </div>
  );
}
