import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users } from "lucide-react";

export default async function DepartmentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "HR_ADMIN") redirect("/dashboard");

  const departments = await prisma.department.findMany({
    include: {
      teams: true,
      _count: { select: { users: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Departments" description="Manage departments and teams" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-8 text-center text-muted-foreground">
              No departments yet. Add departments when creating employees.
            </CardContent>
          </Card>
        ) : (
          departments.map((dept) => (
            <Card key={dept.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="size-4" />
                  {dept.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm">
                  <Users className="size-3.5 text-muted-foreground" />
                  <span>{dept._count.users} employees</span>
                </div>
                {dept.teams.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {dept.teams.map((team) => (
                      <Badge key={team.id} variant="outline" className="text-xs">
                        {team.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
