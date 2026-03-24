import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

export default async function WarningsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  const where: any = {};
  if (role === "EMPLOYEE") where.userId = session.user.id;

  const warnings = await prisma.warning.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const levelColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    VERBAL: "outline",
    FIRST_WRITTEN: "secondary",
    SECOND_WRITTEN: "secondary",
    FINAL: "destructive",
    TERMINATION: "destructive",
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Warnings" description="Employee warnings and strikes" />
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Issued By</TableHead>
                <TableHead>Acknowledged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warnings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No warnings issued.
                  </TableCell>
                </TableRow>
              ) : (
                warnings.map((w: any) => (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm">
                      {w.user.firstName} {w.user.lastName}
                    </TableCell>
                    <TableCell>
                      <Badge variant={levelColors[w.level] || "outline"} className="text-xs">
                        {w.level.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-[250px] truncate">{w.reason}</TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(w.date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {w.issuedBy.firstName} {w.issuedBy.lastName}
                    </TableCell>
                    <TableCell className="text-sm">
                      {w.acknowledged ? "Yes" : "No"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
