import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SessionProvider } from "@/components/providers/session-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Look up the office and (for partners) the teams they manage. This drives
  // the scoped sidebar — Etsy partners see bonus pages, FB partner doesn't.
  const dbUser = await prisma.user.findUnique({
    where: { id: (session.user as any).id },
    select: {
      officeId: true,
      office: { select: { id: true, name: true, slug: true, isPrimary: true } },
      partnerTeams: {
        select: {
          id: true,
          name: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  const user = {
    name: session.user.name || "",
    email: session.user.email || "",
    role: (session.user as any).role || "EMPLOYEE",
    employeeId: (session.user as any).employeeId || "",
    officeId: dbUser?.officeId || "",
    officeName: dbUser?.office?.name || "",
    isPrimaryOffice: dbUser?.office?.isPrimary || false,
    partnerTeams:
      dbUser?.partnerTeams.map((t) => ({
        id: t.id,
        name: t.name,
        departmentName: t.department.name,
      })) || [],
  };

  return (
    <SessionProvider>
      <SidebarProvider>
        <AppSidebar user={user} />
        <SidebarInset>
          <Header />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SessionProvider>
  );
}
