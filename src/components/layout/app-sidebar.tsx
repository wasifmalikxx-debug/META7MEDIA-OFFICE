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
  Calculator,
  Sparkles,
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
    // Daily Reports moved entirely into the per-team partner sections below
    // (Izaan EM / Awais AE / Mubeen ME) and the FB Program section (HQ /
    // Zain). The old aggregated main-nav entry was confusing — every viewer
    // now drills into reports per-team, never mixed.
    { title: "Attendance Calendar", href: "/attendance-calendar", icon: CalendarDays, roles: ["SUPER_ADMIN", "PARTNER"] },
    // Single label for everyone — "Complaints". CEO/HR see the inbox of all
    // complaints (incoming employee complaints + ones the CEO launched). For
    // partners/managers/employees, /complaints scopes to their own thread
    // history only (their incoming complaints from the CEO + outgoing ones
    // they launched themselves).
    { title: "Complaints", href: "/complaints", icon: AlertOctagon, roles: ["all"] },
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

// Per-partner sidebar sections. Each partner section is a self-contained
// home for that team: Bonus Program, Analytics, Review Approvals, Refunds,
// Bonus Guide (+ Team Reports for Izaan). CEO sees all three sections;
// partners see only their own; Izaan (MANAGER) sees the EM section.
//
// The query param ?team=em|ae|me drives server-side scoping on every page —
// CEO clicking "Refunds" under Awais sees only AE-team refunds.
type PartnerSectionItem = {
  title: string;
  href: string;
  icon: any;
  // Marks the Review Approvals link so the badge renders on it. Set on
  // exactly one item per section.
  isReviewLink?: boolean;
};

type PartnerSection = {
  key: "em" | "ae" | "me";
  label: string;
  items: PartnerSectionItem[];
};

function teamItems(key: "em" | "ae" | "me", isIzaan: boolean): PartnerSectionItem[] {
  const items: PartnerSectionItem[] = [
    { title: "Bonus Program", href: `/bonus-program?team=${key}`, icon: Target },
  ];
  // Analytics is CEO + PARTNER only. Izaan is a team lead (MANAGER), not a
  // partner, so the analytics tab is hidden from his EM section. The
  // /etsy-analytics page also blocks MANAGER role server-side as a backstop.
  if (!isIzaan) {
    items.push({ title: "Analytics", href: `/etsy-analytics?team=${key}`, icon: BarChart3 });
  }
  // Team Reports — every Etsy team gets one, scoped server-side via ?team=.
  // CEO sees them per-section now (the global "Daily Reports" main-nav entry
  // was dropped to stop everything mixing together).
  items.push({ title: "Team Reports", href: `/daily-work-report?team=${key}`, icon: FileText });
  items.push(
    {
      title: "Review Approvals",
      href: `/review-bonus?team=${key}`,
      icon: Star,
      isReviewLink: true,
    },
    { title: "Refunds", href: `/refunds?team=${key}`, icon: RefreshCcw },
    { title: "Bonus Guide", href: "/etsy-bonus-guide", icon: BookOpen },
  );
  return items;
}

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

  if (isCeo || isIzaan || partnerDeptHas(" - EM")) {
    sections.push({ key: "em", label: "Izaan (EM)", items: teamItems("em", isIzaan) });
  }
  if (isCeo || partnerDeptHas(" - AE")) {
    sections.push({ key: "ae", label: "Awais (AE)", items: teamItems("ae", false) });
  }
  if (isCeo || partnerDeptHas(" - ME")) {
    sections.push({ key: "me", label: "Mubeen (ME)", items: teamItems("me", false) });
  }

  return sections;
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
  // Pending review counts per Etsy team. CEO populates all three; partners
  // populate just their own; Izaan (MANAGER) populates EM only. Drives the
  // badge on each partner section's "Review Approvals" link.
  const [pendingByTeam, setPendingByTeam] = useState<{ em?: number; ae?: number; me?: number }>({});
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

  // Poll per-team pending review counts every 2 minutes. CEO fetches all
  // three Etsy teams; partners and Izaan fetch their own. The API ignores
  // ?team= for partners/managers (they're already pinned to their scope), so
  // passing it is harmless and keeps the fetch logic uniform.
  useEffect(() => {
    if (
      user.role !== "SUPER_ADMIN" &&
      user.role !== "MANAGER" &&
      user.role !== "PARTNER"
    ) return;

    const teams: ("em" | "ae" | "me")[] = [];
    if (user.role === "SUPER_ADMIN") {
      teams.push("em", "ae", "me");
    } else if (user.role === "MANAGER" && user.employeeId === "EM-4") {
      teams.push("em");
    } else if (user.role === "PARTNER" && user.partnerTeams) {
      for (const t of user.partnerTeams) {
        if (t.departmentName.includes(" - EM")) teams.push("em");
        else if (t.departmentName.includes(" - AE")) teams.push("ae");
        else if (t.departmentName.includes(" - ME")) teams.push("me");
      }
    }
    if (teams.length === 0) return;

    async function fetchAll() {
      const entries = await Promise.all(
        teams.map(async (key) => {
          try {
            const res = await fetch(`/api/review-bonus?status=PENDING&count=true&team=${key}`);
            if (res.ok) {
              const data = await res.json();
              return [key, typeof data.count === "number" ? data.count : 0] as const;
            }
          } catch {}
          return [key, 0] as const;
        })
      );
      setPendingByTeam(Object.fromEntries(entries));
    }
    fetchAll();
    const interval = setInterval(fetchAll, 120_000);
    return () => clearInterval(interval);
  }, [user.role, user.employeeId, user.partnerTeams]);

  // Poll for the complaint badge counter on the sidebar:
  //   CEO/HR → number of OPEN complaints in the inbox (employees launching
  //            something, plus their own threads still in progress).
  //   Everyone else → number of THEIR complaints flagged unread (CEO sent
  //                   them a message they haven't opened yet — covers both
  //                   CEO-launched complaints and CEO replies on threads
  //                   they themselves opened).
  useEffect(() => {
    const isAdminUser = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";
    async function fetchComplaints() {
      try {
        const res = await fetch(isAdminUser ? "/api/complaints?status=OPEN" : "/api/complaints");
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        if (isAdminUser) {
          setOpenComplaints(data.length);
        } else {
          // The GET endpoint already scopes non-admin queries to userId =
          // session.user.id, so this list is just the current user's
          // threads. Count the ones where the CEO has new content for them.
          setOpenComplaints(data.filter((c: any) => c.unreadByEmployee).length);
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
              {item.href === "/complaints" && openComplaints > 0 && (
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

        {/* Etsy Tools — utility links that aren't team-scoped. Sits directly
            below the main nav for all Etsy roles (CEO, Etsy partners, Izaan,
            EM-/AE-/ME- employees) so the calculator is reachable in one
            click without scrolling past team sections. Strictly Etsy-side:
            FB-team employees (SMM-*) and the FB partner (Zain) never see
            this — visibility mirrors the page guard. */}
        {(() => {
          const isCeo = user.role === "SUPER_ADMIN";
          const isHrAdmin = user.role === "HR_ADMIN";
          const isIzaan = user.role === "MANAGER" && user.employeeId === "EM-4";
          const isEtsyPartner =
            user.role === "PARTNER" &&
            (user.partnerTeams ?? []).some(
              (t) =>
                t.departmentName.includes(" - EM") ||
                t.departmentName.includes(" - AE") ||
                t.departmentName.includes(" - ME"),
            );
          const isEtsyEmployee =
            (user.employeeId?.startsWith("EM") ||
              user.employeeId?.startsWith("AE") ||
              user.employeeId?.startsWith("ME")) &&
            user.employeeId !== "EM-4L";
          // SEO Autopilot live roster (May 15 2026) — CEO + Izaan + EM
          // employees + Etsy partners (Awais, Mubeen). AE/ME teams + HR
          // still see "Soon". Mirrors page.tsx + API route gate.
          const isEmEmployee =
            user.employeeId?.startsWith("EM") &&
            user.employeeId !== "EM-4" &&
            user.employeeId !== "EM-4L";
          const isEmTeam = isIzaan || isEmEmployee;
          const hasAutopilotBeta = isCeo || isEmTeam || isEtsyPartner;
          const showTools =
            isCeo || isHrAdmin || isIzaan || isEtsyPartner || isEtsyEmployee;
          if (!showTools) return null;
          return (
            <SidebarGroup>
              <SidebarGroupLabel>Etsy Tools</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {/* CEO-only: full-page Autopilot analytics dashboard sits
                      at the top of the Etsy Tools group so Wasif can jump
                      to it in one click — it's the most-visited admin
                      surface during the EM-team test rollout. */}
                  {isCeo && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        render={<Link href="/seo-autopilot/dashboard" />}
                        isActive={isItemActive("/seo-autopilot/dashboard")}
                      >
                        <BarChart3 className="size-4" />
                        <span>Autopilot Dashboard</span>
                        <span className="ml-auto inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-950/50 px-1.5 py-0.5 text-[9px] font-bold text-violet-700 dark:text-violet-300 tracking-wider uppercase">
                          Admin
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {/* Product Hunter — finds underserved Etsy niches before
                      sending the team to AliExpress. Launched to the full
                      Etsy team May 18 2026 (CEO + Izaan + EM + AE + ME +
                      Etsy partners). No pill — tool is fully live and the
                      "Live" badge added visual clutter to a settled tool.
                      Users without access still land on the Coming Soon
                      placeholder when clicking through. */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/seo-autopilot/product-hunter" />}
                      isActive={isItemActive(
                        "/seo-autopilot/product-hunter",
                      )}
                    >
                      <Target className="size-4" />
                      <span>Product Hunter</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Removed sub-tools (kept here as a trail for future
                      contributors):
                        - Reverse Hunt    (May 17 2026)
                        - Image Hunt      (May 17 2026)
                        - Daily Trending  (May 18 2026)
                        - "More Soon"     (May 18 2026)
                      Product Hunter is now a single-pane tool — no tabs,
                      no sub-routes. */}

                  {/* Product Validator — pre-listing Etsy policy check.
                      Launched to the full Etsy team May 18 2026 (CEO +
                      Izaan + EM + AE + ME + Etsy partners). No pill,
                      matching the Price Calculator + Product Hunter
                      pattern — settled tools without a Beta badge feel
                      cleaner in the sidebar. */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/product-validator" />}
                      isActive={isItemActive("/product-validator")}
                    >
                      <ShieldCheck className="size-4" />
                      <span>Product Validator</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/price-calculator" />}
                      isActive={isItemActive("/price-calculator")}
                    >
                      <Calculator className="size-4" />
                      <span>Price Calculator</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/seo-autopilot" />}
                      isActive={isItemActive("/seo-autopilot")}
                    >
                      <Sparkles className="size-4" />
                      <span>SEO Autopilot</span>
                      {/* Live for: CEO + Izaan + EM employees + Etsy
                          partners (Awais, Mubeen) → green "BETA" pill with
                          a pulsing dot. AE/ME/HR still see Coming Soon →
                          violet "SOON" pill. */}
                      {hasAutopilotBeta ? (
                        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 tracking-wider uppercase">
                          <span className="relative flex size-1">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                            <span className="relative inline-flex size-1 rounded-full bg-emerald-500" />
                          </span>
                          Beta
                        </span>
                      ) : (
                        <span className="ml-auto inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-950/50 px-1.5 py-0.5 text-[9px] font-bold text-violet-700 dark:text-violet-300 tracking-wider uppercase">
                          Soon
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })()}

        {/* Per-partner sections — one group per Etsy team. CEO sees all three;
            partners see only their own; Izaan (MANAGER) sees the EM group.
            Each section is self-contained: Bonus Program, Analytics, Review
            Approvals, Refunds, Bonus Guide (+ Team Reports for Izaan). */}
        {(() => {
          const partnerSections = getPartnerSections(user.role, user.employeeId || "", user.partnerTeams);
          const hasPartnerSections = partnerSections.length > 0;
          const isEtsyEmployee =
            !hasPartnerSections &&
            (user.employeeId?.startsWith("EM") ||
              user.employeeId?.startsWith("AE") ||
              user.employeeId?.startsWith("ME")) &&
            user.employeeId !== "EM-4L";

          return (
            <>
              {partnerSections.map((section) => (
                <SidebarGroup key={section.key}>
                  <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {section.items.map((item) => {
                        const teamPending = item.isReviewLink ? pendingByTeam[section.key] ?? 0 : 0;
                        return (
                          <SidebarMenuItem key={`${section.key}-${item.href}`}>
                            <SidebarMenuButton render={<Link href={item.href} />} isActive={isItemActive(item.href)}>
                              <item.icon className="size-4" />
                              <span>{item.title}</span>
                              {item.isReviewLink && teamPending > 0 && (
                                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center">
                                  {teamPending}
                                </Badge>
                              )}
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}

              {/* Shared Etsy group — only renders for plain Etsy employees who
                  don't have a partner section. Gives them Submit Review /
                  Submit Refund / Bonus Guide. */}
              {isEtsyEmployee &&
                getEtsyNav(user.role, user.employeeId || "").some((item) => hasAccess(item.roles, user.role)) && (
                  <SidebarGroup>
                    <SidebarGroupLabel>Etsy</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>{renderNavItems(getEtsyNav(user.role, user.employeeId || ""))}</SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}

            </>
          );
        })()}

        {/* FB Program — restructured into per-team entries:
            - Bonus Program        (CEO + SMM-* employees; hidden from Zain per "FB is simple")
            - Facebook HQ Reports  (CEO only — HQ has no partner, Wasif manages directly)
            - Zain Team Reports    (CEO + Zain — his FB-O2 team)
            Visible if any item is visible. */}
        {(() => {
          const isCeo = user.role === "SUPER_ADMIN";
          const isSmm = !!user.employeeId?.startsWith("SMM");
          const isZain =
            user.role === "PARTNER" &&
            (user.partnerTeams?.some((t) => t.departmentName.includes(" - O2")) ?? false);

          const showBonus = isCeo || isSmm; // unchanged; Zain still excluded
          const showHqReports = isCeo;
          const showZainReports = isCeo || isZain;

          if (!showBonus && !showHqReports && !showZainReports) return null;

          return (
            <SidebarGroup>
              <SidebarGroupLabel>FB Program</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {showBonus && (
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive={pathname === "/fb-program"} render={<Link href="/fb-program" />}>
                        <Rocket className="size-4" />
                        <span>Bonus Program</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {showHqReports && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={isItemActive("/daily-work-report?team=fb-hq")}
                        render={<Link href="/daily-work-report?team=fb-hq" />}
                      >
                        <FileText className="size-4" />
                        <span>HQ Team Reports</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {showZainReports && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={isItemActive("/daily-work-report?team=fb-o2")}
                        render={<Link href="/daily-work-report?team=fb-o2" />}
                      >
                        <FileText className="size-4" />
                        <span>Zain Team Reports</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })()}

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
