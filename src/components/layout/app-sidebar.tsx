"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Users,
  Building2,
  Wallet,
  AlertTriangle,
  CalendarClock,
  Settings,
  User,
  LogOut,
  ShieldCheck,
  HelpCircle,
  Target,
  Star,
  BookOpen,
  Rocket,
  MessageSquare,
  BarChart3,
  CalendarDays,
  AlertOctagon,
  RefreshCcw,
  FileText,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";



interface AppSidebarProps {
  user: {
    name: string;
    email: string;
    role: string;
    employeeId: string;
  };
}

function getMainNav(userRole: string) {
  const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HR_ADMIN";
  return [
    { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["all"] },
    { title: "Daily Activities", href: "/fines", icon: CalendarClock, roles: ["all"] },
    { title: "Attendance Calendar", href: "/attendance", icon: CalendarDays, roles: ["EMPLOYEE", "MANAGER"] },
    { title: "My Reports", href: "/my-reports", icon: BarChart3, roles: ["EMPLOYEE", "MANAGER"] },
    { title: "Daily Reports", href: "/daily-work-report", icon: BarChart3, roles: ["SUPER_ADMIN"] },
    { title: "Attendance Calendar", href: "/attendance-calendar", icon: CalendarDays, roles: ["SUPER_ADMIN"] },
    // CEO sees "Complaints", employees see "Launch Complaint"
    { title: isAdmin ? "Complaints" : "Launch Complaint", href: "/complaints", icon: AlertOctagon, roles: ["all"] },
  ];
}

const managementNav = [
  { title: "Employees", href: "/employees", icon: Users, roles: ["SUPER_ADMIN"] },
  { title: "Departments", href: "/departments", icon: Building2, roles: ["SUPER_ADMIN"] },
  { title: "Login Approvals", href: "/login-approvals", icon: ShieldCheck, roles: ["SUPER_ADMIN"] },
];

const financeNav = [
  { title: "Payroll", href: "/payroll", icon: Wallet, roles: ["all"] },
];

function getEtsyNav(userRole: string, employeeId: string) {
  const isAdminOrManager = userRole === "SUPER_ADMIN" || userRole === "MANAGER";
  // Izaan (EM-4) is Etsy team lead — gets the admin-style label even though
  // his role is EMPLOYEE, because he sees all refunds but doesn't submit
  const isTeamLead = employeeId === "EM-4";
  const nav: { title: string; href: string; icon: any; roles: string[] }[] = [
    { title: "Bonus Program", href: "/bonus-program", icon: Target, roles: ["SUPER_ADMIN", "MANAGER"] },
    { title: "Analytics", href: "/etsy-analytics", icon: BarChart3, roles: ["SUPER_ADMIN"] },
  ];
  // Izaan only: Etsy team reports view (scoped to EM-* employees on the server)
  if (isTeamLead) {
    nav.push({
      title: "Team Reports",
      href: "/daily-work-report",
      icon: FileText,
      roles: ["all"],
    });
  }
  nav.push(
    {
      title: isAdminOrManager ? "Review Approvals" : "Submit Review",
      href: "/review-bonus",
      icon: Star,
      roles: ["all"],
    },
    // Refunds: CEO + Izaan see 'Refunds' (all), other Etsy employees see 'Submit Refund'
    {
      title: isAdminOrManager || isTeamLead ? "Refunds" : "Submit Refund",
      href: "/refunds",
      icon: RefreshCcw,
      roles: ["all"],
    },
    { title: "Bonus Guide", href: "/etsy-bonus-guide", icon: BookOpen, roles: ["all"] }
  );
  return nav;
}

const settingsNav = [
  { title: "Office Timings", href: "/settings", icon: Settings, roles: ["SUPER_ADMIN"] },
  { title: "How It Works", href: "/how-it-works", icon: HelpCircle, roles: ["all"] },
  { title: "Automated Messages", href: "/automated-messages", icon: MessageSquare, roles: ["SUPER_ADMIN"] },
];

function hasAccess(roles: string[], userRole: string) {
  return roles.includes("all") || roles.includes(userRole);
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const [pendingDevices, setPendingDevices] = useState(0);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [openComplaints, setOpenComplaints] = useState(0);

  // Poll for pending device approvals every 30 seconds (CEO only)
  useEffect(() => {
    if (user.role !== "SUPER_ADMIN") return;
    async function fetchPending() {
      try {
        const res = await fetch("/api/device-approval");
        if (res.ok) {
          const devices = await res.json();
          setPendingDevices(devices.filter((d: any) => d.status === "PENDING").length);
        }
      } catch {}
    }
    fetchPending();
    const interval = setInterval(fetchPending, 120_000);
    return () => clearInterval(interval);
  }, [user.role]);

  // Poll for pending review bonus submissions every 2 minutes (CEO/Manager only)
  useEffect(() => {
    if (user.role !== "SUPER_ADMIN" && user.role !== "MANAGER") return;
    async function fetchPendingReviews() {
      try {
        const res = await fetch("/api/review-bonus?status=PENDING&count=true");
        if (res.ok) {
          const data = await res.json();
          setPendingReviews(typeof data.count === "number" ? data.count : 0);
        }
      } catch {}
    }
    fetchPendingReviews();
    const interval = setInterval(fetchPendingReviews, 120_000);
    return () => clearInterval(interval);
  }, [user.role]);

  // Poll for open complaints (CEO only — shows OPEN + IN_PROGRESS)
  useEffect(() => {
    if (user.role !== "SUPER_ADMIN" && user.role !== "HR_ADMIN") return;
    async function fetchComplaints() {
      try {
        const res = await fetch("/api/complaints?status=OPEN");
        if (res.ok) {
          const data = await res.json();
          setOpenComplaints(Array.isArray(data) ? data.length : 0);
        }
      } catch {}
    }
    fetchComplaints();
    const interval = setInterval(fetchComplaints, 120_000);
    return () => clearInterval(interval);
  }, [user.role]);

  const mainNav = getMainNav(user.role);

  const renderNavItems = (items: { title: string; href: string; icon: any; roles: string[] }[]) =>
    items
      .filter((item) => hasAccess(item.roles, user.role))
      .map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton render={<Link href={item.href} />} isActive={pathname === item.href}>
              <item.icon className="size-4" />
              <span>{item.title}</span>
              {item.href === "/login-approvals" && pendingDevices > 0 && (
                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center">
                  {pendingDevices}
                </Badge>
              )}
              {item.href === "/review-bonus" && pendingReviews > 0 && (
                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center">
                  {pendingReviews}
                </Badge>
              )}
              {item.href === "/complaints" && openComplaints > 0 && (user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN") && (
                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center">
                  {openComplaints}
                </Badge>
              )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ));

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img src="/logo.png" alt="META7MEDIA" className="h-8 w-auto" />
          <div className="flex flex-col">
            <span className="text-sm font-bold">META7MEDIA AI</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Office Manager</span>
            <span className="text-[8px] text-muted-foreground/60">Powered By: Google</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderNavItems(mainNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {managementNav.some((item) => hasAccess(item.roles, user.role)) && (
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(managementNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Finance</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderNavItems(financeNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Etsy Program — only for Etsy employees (EM-), Manager (EM-4), and CEO */}
        {(user.role === "SUPER_ADMIN" || user.role === "MANAGER" || user.employeeId?.startsWith("EM")) &&
          getEtsyNav(user.role, user.employeeId || "").some((item) => hasAccess(item.roles, user.role)) && (
          <SidebarGroup>
            <SidebarGroupLabel>Etsy Program</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(getEtsyNav(user.role, user.employeeId || ""))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* FB Program — only for FB employees (SMM-) and CEO */}
        {(user.role === "SUPER_ADMIN" || user.employeeId?.startsWith("SMM")) && (
          <SidebarGroup>
            <SidebarGroupLabel>FB Program</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={pathname === "/fb-program"} render={<Link href="/fb-program" />}>
                    <Rocket className="size-4" />
                    <span>Bonus Program</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {settingsNav.some((item) => hasAccess(item.roles, user.role)) && (
          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(settingsNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton className="w-full" />}>
                  <Avatar className="size-6">
                    {(user as any).role === "SUPER_ADMIN" ? (
                      <img src="/logo.png" alt="CEO" className="size-6 object-contain" />
                    ) : (
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex flex-col items-start text-left">
                    <span className="text-sm">{user.name}</span>
                    <span className="text-xs text-muted-foreground">{user.employeeId}</span>
                  </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <DropdownMenuItem render={<Link href="/profile" />}>
                    <User className="mr-2 size-4" />
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  await signOut({ redirect: false });
                  window.location.href = "/login";
                }}>
                    <LogOut className="mr-2 size-4" />
                    Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
