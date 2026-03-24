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

  const unreadCount = await prisma.notification.count({
    where: { userId: session.user.id, isRead: false },
  });

  const user = {
    name: session.user.name || "",
    email: session.user.email || "",
    role: (session.user as any).role || "EMPLOYEE",
    employeeId: (session.user as any).employeeId || "",
  };

  return (
    <SessionProvider>
      <SidebarProvider>
        <AppSidebar user={user} unreadCount={unreadCount} />
        <SidebarInset>
          <Header unreadCount={unreadCount} />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SessionProvider>
  );
}
