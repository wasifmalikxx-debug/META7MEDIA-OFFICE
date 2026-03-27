import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { LeavesView } from "@/components/leaves/leaves-view";

export const dynamic = "force-dynamic";

export default async function LeavesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";

  const where: any = {};
  if (!isAdmin) {
    where.userId = session.user.id;
  }

  const [leaves, balance] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        approver: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.leaveBalance.findUnique({
      where: {
        userId_year: { userId: session.user.id, year: new Date(Date.now() + 5 * 60 * 60_000).getUTCFullYear() },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Management"
        description={isAdmin ? "Manage employee leave requests" : "Apply and track your leaves"}
      />
      <LeavesView
        leaves={JSON.parse(JSON.stringify(leaves))}
        balance={balance ? JSON.parse(JSON.stringify(balance)) : null}
        isAdmin={isAdmin}
        userId={session.user.id}
      />
    </div>
  );
}
