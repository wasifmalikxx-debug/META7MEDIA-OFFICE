import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { FinesView } from "@/components/incentives-fines/fines-view";

export default async function FinesPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();

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
          where: { status: { in: ["HIRED", "PROBATION"] }, role: { not: "SUPER_ADMIN" } },
          select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } },
          orderBy: { employeeId: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Fines & Penalties" />
      <FinesView
        fines={JSON.parse(JSON.stringify(fines))}
        employees={JSON.parse(JSON.stringify(employees))}
        isAdmin={isAdmin}
        currentMonth={month}
        currentYear={year}
      />
    </div>
  );
}
