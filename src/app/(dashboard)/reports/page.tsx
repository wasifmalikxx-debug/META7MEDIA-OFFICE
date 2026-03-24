import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Calendar, Wallet, Users } from "lucide-react";
import Link from "next/link";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN") redirect("/dashboard");

  const reports = [
    {
      title: "Attendance Report",
      description: "Monthly attendance summary by employee",
      icon: Calendar,
      href: "/attendance",
    },
    {
      title: "Payroll Report",
      description: "Monthly salary and payroll summary",
      icon: Wallet,
      href: "/payroll",
    },
    {
      title: "Leave Report",
      description: "Employee leave history and balance",
      icon: Users,
      href: "/leaves",
    },
    {
      title: "Fines Report",
      description: "Monthly fines and penalties overview",
      icon: BarChart3,
      href: "/fines",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="View and export reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {reports.map((report) => (
          <Link key={report.title} href={report.href}>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <report.icon className="size-8 text-muted-foreground" />
                <CardTitle className="text-base">{report.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {report.description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
