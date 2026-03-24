import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { FinesView } from "@/components/incentives-fines/fines-view";

export default async function FinesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();

  const where: any = { month, year };
  if (!isAdmin) where.userId = session.user.id;

  const [fines, employees] = await Promise.all([
    prisma.fine.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, employeeId: true } },
        issuedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    isAdmin
      ? prisma.user.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, firstName: true, lastName: true, employeeId: true },
          orderBy: { firstName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Fines & Penalties" description="Manage employee fines and deductions" />
      <FinesView
        fines={JSON.parse(JSON.stringify(fines))}
        employees={employees}
        isAdmin={isAdmin}
      />
    </div>
  );
}
