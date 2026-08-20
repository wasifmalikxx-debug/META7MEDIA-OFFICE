import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDeviceSessionBlocked, isLockedByMaintenance } from "@/lib/api-helpers";
import { AppShell } from "@/components/layout/shell";
import { SIDEBAR_COOKIE } from "@/lib/shell-constants";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SessionProvider } from "@/components/providers/session-provider";
import { MaintenanceScreen } from "@/components/layout/maintenance-screen";
import { MaintenanceWatcher } from "@/components/layout/maintenance-watcher";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Device-binding enforcement (only active when DEVICE_ENFORCEMENT=true).
  // A session from an unapproved device is sent back to /login, where the
  // device screens explain the pending/rejected state. SUPER_ADMIN and
  // pre-enforcement sessions are never blocked (see isDeviceSessionBlocked).
  if (isDeviceSessionBlocked(session)) {
    redirect("/login");
  }

  // Look up the office and (for partners) the teams they manage. This drives
  // the scoped sidebar — Etsy partners see bonus pages, FB partner doesn't.
  const dbUser = await prisma.user.findUnique({
    where: { id: (session.user as any).id },
    select: {
      status: true,
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

  // H1: live employment-status gate for page navigation. Folded into the
  // existing lookup (no extra query). A terminated/resigned/deleted account is
  // sent back to /login immediately, not just blocked on its next API call.
  if (!dbUser || dbUser.status === "RESIGNED" || dbUser.status === "TERMINATED") {
    redirect("/login");
  }

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

  // MAINTENANCE_MODE=true locks the portal for everyone except the CEO.
  //
  // Placed here on purpose: after the auth, device and employment gates (so a
  // terminated account is still bounced to /login rather than shown a notice),
  // and before the shell is built — returning early means a locked-out user's
  // browser is never sent the sidebar, the header or any page data.
  //
  // SUPER_ADMIN is exempt inside isLockedByMaintenance, so this cannot lock
  // the CEO out of his own portal.
  if (isLockedByMaintenance(user.role)) {
    return <MaintenanceScreen name={user.name} employeeId={user.employeeId} />;
  }

  // Read the sidebar's pinned state on the server so the first paint already
  // has the right content offset — otherwise a rail user watches the layout
  // jump from 256px to 56px on every navigation.
  const cookieStore = await cookies();
  const defaultPinned = cookieStore.get(SIDEBAR_COOKIE)?.value !== "false";

  return (
    <SessionProvider>
      <AppShell
        defaultPinned={defaultPinned}
        sidebar={<AppSidebar user={user} />}
        header={<Header user={user} />}
      >
        {/* Kicks an already-open tab into the notice when the portal is
            locked. Never rendered for the CEO: he is exempt from the gate,
            so reloading him would just return the portal and loop. */}
        {user.role !== "SUPER_ADMIN" && <MaintenanceWatcher expect="off" />}
        {children}
      </AppShell>
    </SessionProvider>
  );
}
