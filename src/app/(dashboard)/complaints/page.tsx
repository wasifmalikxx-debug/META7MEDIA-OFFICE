import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { ComplaintsView } from "@/components/complaints/complaints-view";

export const dynamic = "force-dynamic";

export default async function ComplaintsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN" || role === "HR_ADMIN";
  const userId = session.user.id;

  const where = isAdmin ? {} : { userId };

  const complaints = await prisma.complaint.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      resolvedBy: { select: { firstName: true, lastName: true } },
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { message: true, senderRole: true, createdAt: true },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Launch Complaint"
        description={
          isAdmin
            ? "Review and respond to employee complaints — full confidentiality"
            : "Your direct private channel to the CEO — fully confidential"
        }
      />
      <ComplaintsView
        initialComplaints={JSON.parse(JSON.stringify(complaints))}
        isAdmin={isAdmin}
        currentUserId={userId}
      />
    </div>
  );
}
