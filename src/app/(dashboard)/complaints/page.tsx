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
      respondedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints"
        description={
          isAdmin
            ? "Review and respond to employee complaints"
            : "Submit and track your complaints — fully confidential"
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
