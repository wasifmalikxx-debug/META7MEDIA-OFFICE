import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { DepartmentsView } from "@/components/departments/departments-view";

export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") redirect("/dashboard");

  const [departments, offices] = await Promise.all([
    prisma.department.findMany({
      include: {
        _count: { select: { users: true } },
        office: { select: { id: true, name: true, slug: true, isPrimary: true } },
      },
      orderBy: [{ office: { isPrimary: "desc" } }, { name: "asc" }],
    }),
    // Offices powering the New / Edit Department dialog Office picker. The
    // CEO needs to be able to file a department under either office. Order:
    // primary office first, then alphabetical by name.
    prisma.office.findMany({
      select: { id: true, name: true, slug: true, isPrimary: true },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Departments" description="Manage office departments" />
      <DepartmentsView
        departments={JSON.parse(JSON.stringify(departments))}
        offices={JSON.parse(JSON.stringify(offices))}
      />
    </div>
  );
}
