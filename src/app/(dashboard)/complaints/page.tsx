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
      // Multi-office: pull team + office so the CEO can see at a glance
      // which partner the complainant belongs to (e.g. "Awais's employee"
      // vs "Mubeen's employee") without cross-referencing the employee list.
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
          team: {
            select: {
              name: true,
              partner: { select: { firstName: true, lastName: true } },
            },
          },
          department: { select: { name: true } },
          office: { select: { name: true } },
        },
      },
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

  // For the CEO's "Launch Complaint" picker — every active employee with
  // their team / department for context. Auto-refreshes via the view's 30s
  // router.refresh polling, so newly hired employees show up without a
  // manual reload.
  const targetEmployees = isAdmin
    ? await prisma.user.findMany({
        where: {
          status: { in: ["HIRED", "PROBATION"] },
          role: { notIn: ["SUPER_ADMIN", "HR_ADMIN"] },
        },
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
          team: { select: { name: true } },
        },
        orderBy: { employeeId: "asc" },
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints"
        description={
          isAdmin
            ? "Review, respond, and open new complaint threads — full confidentiality"
            : "Your direct private channel to the CEO — fully confidential"
        }
      />
      <ComplaintsView
        initialComplaints={JSON.parse(JSON.stringify(complaints))}
        isAdmin={isAdmin}
        currentUserId={userId}
        targetEmployees={JSON.parse(JSON.stringify(targetEmployees))}
      />
    </div>
  );
}
