"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  CalendarMinus,
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



interface PartnerTeamInfo {
  id: string;
  name: string;
  departmentName: string;
}

interface AppSidebarProps {
  user: {
    name: string;
    email: string;
    role: string;
    employeeId: string;
    officeId?: string;
    officeName?: string;
    isPrimaryOffice?: boolean;
    partnerTeams?: PartnerTeamInfo[];
  };
}

function getMainNav(userRole: string) {
  const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HR_ADMIN";
  return [
    { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["all"] },
    { title: "Daily Activities", href: "/fines", icon: CalendarClock, roles: ["all"] },
    { title: "Attendance Calendar", href: "/attendance", icon: CalendarDays, roles: ["EMPLOYEE", "MANAGER"] },
    { title: "My Reports", href: "/my-reports", icon: BarChart3, roles: ["EMPLOYEE", "MANAGER"] },
    // Daily Reports: CEO sees all teams; PARTNER sees their own team's reports
    // (server-scoped). Izaan also has a separate "Team Reports" entry under the
    // Etsy nav so he doesn't need this main-nav one.
    { title: "Daily Reports", href: "/daily-work-report", icon: BarChart3, roles: ["SUPER_ADMIN", "PARTNER"] },
    { title: "Attendance Calendar", href: "/attendance-calendar", icon: CalendarDays, roles: ["SUPER_ADMIN", "PARTNER"] },
    // CEO/HR sees "Complaints" inbox; PARTNER and employees see "Launch Complaint"
    // — partners can submit complaints to the CEO but never see other people's
    // complaints (the CEO is the only inbox per office rule).
    { title: isAdmin ? "Complaints" : "Launch Complaint", href: "/complaints", icon: AlertOctagon, roles: ["all"] },
  ];
}

const managementNav = [
  // PARTNER also sees Employees + Leave Management — server-side scoped to their team
  { title: "Employees", href: "/employees", icon: Users, roles: ["SUPER_ADMIN", "PARTNER"] },
  { title: "Departments", href: "/departments", icon: Building2, roles: ["SUPER_ADMIN"] },
  { title: "Leave Management", href: "/leaves", icon: CalendarMinus, roles: ["SUPER_ADMIN", "PARTNER"] },
  { title: "Login Approvals", href: "/login-approvals", icon: ShieldCheck, roles: ["SUPER_ADMIN"] },
];

const financeNav = [
  { title: "Payroll", href: "/payroll", icon: Wallet, roles: ["all"] },
];

// Common Etsy items everyone in the program sees (Reviews, Refunds, Bonus Guide).
// Per-team Bonus Program / Analytics / Team Reports moved into partner-specific
// groups below — see getPartnerSections().
function getEtsyNav(userRole: string, employeeId: string) {
  const isAdminOrManager = userRole === "SUPER_ADMIN" || userRole === "MANAGER";
  const isPartner = userRole === "PARTNER";
  // Izaan (EM-4) is Etsy team lead — gets the admin-style label even though
  // his role is EMPLOYEE, because he sees all refunds but doesn't submit
  const isTeamLead = employeeId === "EM-4";
  const isAdminLikeView = isAdminOrManager || isPartner;

  return [
    {
      title: isAdminLikeView ? "Review Approvals" : "Submit Review",
      href: "/review-bonus",
      icon: Star,
      roles: ["all"],
    },
    {
      title: isAdminLikeView || isTeamLead ? "Refunds" : "Submit Refund",
      href: "/refunds",
      icon: RefreshCcw,
      roles: ["all"],
    },
    { title: "Bonus Guide", href: "/etsy-bonus-guide", icon: BookOpen, roles: ["all"] },
  ];
}

// Per-partner sidebar sections. Each partner gets their own group with their
// team's Bonus Program + Analytics. CEO sees all three groups; partners see
// only their own; Izaan (MANAGER) sees the EM group with an extra Team Reports
// entry. The query param ?team=em|ae|me drives server-side scoping.
type PartnerSection = {
  key: "em" | "ae" | "me";
  label: string;
  items: { title: string; href: string; icon: any }[];
};

function getPartnerSections(
  userRole: string,
  employeeId: string,
  partnerTeams?: PartnerTeamInfo[]
): PartnerSection[] {
  const isCeo = userRole === "SUPER_ADMIN";
  const isIzaan = userRole === "MANAGER" && employeeId === "EM-4";
  const partnerDeptHas = (suffix: string) =>
    partnerTeams?.some((t) => t.departmentName.includes(suffix)) ?? false;

  const sections: PartnerSection[] = [];

  // EM group — visible to CEO and Izaan. (No partner currently manages EM,
  // but partnerDeptHas covers it for future flexibility.)
  if (isCeo || isIzaan || partnerDeptHas(" - EM")) {
    const items: { title: string; href: string; icon: any }[] = [
      { title: "Bonus Program", href: "/bonus-program?team=em", icon: Target },
      { title: "Analytics", href: "/etsy-analytics?team=em", icon: BarChart3 },
    ];
    // Izaan only: dedicated team-reports view scoped to EM-* on the server.
    // CEO already gets all-team Daily Reports in the main nav, so no duplicate.
    if (isIzaan) {
      items.push({ title: "Team Reports", href: "/daily-work-report", icon: FileText });
    }
    sections.push({ key: "em", label: "Izaan (EM)", items });
  }

  // AE group — visible to CEO and Awais.
  if (isCeo || partnerDeptHas(" - AE")) {
    sections.push({
      key: "ae",
      label: "Awais (AE)",
      items: [
        { title: "Bonus Program", href: "/bonus-program?team=ae", icon: Target },
        { title: "Analytics", href: "/etsy-analytics?team=ae", icon: BarChart3 },
      ],
    });
  }

  // ME group — visible to CEO and Mubeen.
  if (isCeo || partnerDeptHas(" - ME")) {
    sections.push({
      key: "me",
      label: "Mubeen (ME)",
      items: [
        { title: "Bonus Program", href: "/bonus-program?team=me", icon: Target },
        { title: "Analytics", href: "/etsy-analytics?team=me", icon: BarChart3 },
      ],
    });
  }

  return sections;
}

// Returns true if the partner manages an Etsy-style team (department name contains "Etsy")
function isPartnerOfEtsyTeam(partnerTeams?: PartnerTeamInfo[]): boolean {
  if (!partnerTeams || partnerTeams.length === 0) return false;
  return partnerTeams.some((t) => t.departmentName.toLowerCase().includes("etsy"));
}

// Returns true if the partner manages a Facebook-style team
function isPartnerOfFbTeam(partnerTeams?: PartnerTeamInfo[]): boolean {
  if (!partnerTeams || partnerTeams.length === 0) return false;
  return partnerTeams.some((t) => t.departmentName.toLowerCase().includes("facebook"));
}

const settingsNav = [
  // Office settings: only CEO can edit. Partners don't see settings — office
  // hours/holidays are controlled globally per Wasif's policy.
  { title: "Office Timings", href: "/settings", icon: Settings, roles: ["SUPER_ADMIN"] },
  { title: "How It Works", href: "/how-it-works", icon: HelpCircle, roles: ["all"] },
  // Automated messages: CEO only.
  { title: "Automated Messages", href: "/automated-messages", icon: MessageSquare, roles: ["SUPER_ADMIN"] },
];

function hasAccess(roles: string[], userRole: string) {
  return roles.includes("all") || roles.includes(userRole);
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTeam = searchParams.get("team");
  const [pendingDevices, setPendingDevices] = useState(0);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [openComplaints, setOpenComplaints] = useState(0);

  // Active-state check that handles ?team= query params on /bonus-program and
  // /etsy-analytics. For partner-specific links, the team param must match.
  function isItemActive(href: string): boolean {
    const [path, queryStr] = href.split("?");
    if (pathname !== path) return false;
    if (!queryStr) return true;
    const itemTeam = new URLSearchParams(queryStr).get("team");
    if (!itemTeam) return true;
    return currentTeam === itemTeam;
  }

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

  // Poll for pending review bonus submissions every 2 minutes
  // (CEO / Manager / Etsy PARTNERs). The API scopes the count by role —
  // PARTNERs only see their own team's pending count.
  useEffect(() => {
    if (
      user.role !== "SUPER_ADMIN" &&
      user.role !== "MANAGER" &&
      user.role !== "PARTNER"
    ) return;
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
          <SidebarMenuButton render={<Link href={item.href} />} isActive={isItemActive(item.href)}>
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

        {/* Per-partner sections — one collapsible group per Etsy team. Each
            renders only when relevant: CEO sees all three; partners see only
            their own; Izaan (MANAGER) sees the EM group with Team Reports. */}
        {getPartnerSections(user.role, user.employeeId || "", user.partnerTeams).map((section) => (
          <SidebarGroup key={section.key}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton render={<Link href={item.href} />} isActive={isItemActive(item.href)}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {/* Etsy common — Reviews / Refunds / Bonus Guide. Visible to anyone in
            the Etsy program: CEO, Izaan (MANAGER), Etsy partners, and EM/AE/ME
            employees (excluding EM-4L who's on non-Etsy ecom work). */}
        {(user.role === "SUPER_ADMIN" ||
          user.role === "MANAGER" ||
          (user.role === "PARTNER" && isPartnerOfEtsyTeam(user.partnerTeams)) ||
          ((user.employeeId?.startsWith("EM") || user.employeeId?.startsWith("AE") || user.employeeId?.startsWith("ME")) && user.employeeId !== "EM-4L")) &&
          getEtsyNav(user.role, user.employeeId || "").some((item) => hasAccess(item.roles, user.role)) && (
          <SidebarGroup>
            <SidebarGroupLabel>Etsy</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(getEtsyNav(user.role, user.employeeId || ""))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* FB Program — visible to:
            - CEO (sees all)
            - FB employees (SMM- prefix)
            - PARTNER who manages a Facebook team (Zain) — but Zain's view is intentionally
              minimal: just employees + payroll, no bonus program. So we hide this section
              for the FB partner per Wasif's "Facebook is simple" instruction. */}
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
