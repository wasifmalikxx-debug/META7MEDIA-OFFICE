import {
  LayoutDashboard,
  CalendarClock,
  CalendarDays,
  BarChart3,
  AlertOctagon,
  Users,
  Building2,
  CalendarMinus,
  ShieldCheck,
  Wallet,
  Target,
  FileText,
  Star,
  RefreshCcw,
  BookOpen,
  Calculator,
  Sparkles,
  Wand2,
  Rocket,
  Settings,
  HelpCircle,
  MessageSquare,
  Store,
} from "lucide-react";

/**
 * Sidebar navigation model.
 *
 * This file is PRESENTATION-FREE on purpose: it decides *what* a given user
 * may see, and nothing about how it looks. Both the sidebar and the ⌘K
 * command palette read from it, so a role gate can never drift between the
 * two surfaces.
 *
 * The role rules here are a verbatim port of the pre-redesign sidebar
 * (getMainNav / managementNav / getEtsyNav / getPartnerSections / …). If you
 * change a `roles` array or a predicate you are changing who can see a page —
 * check the matching server-side guard before you do.
 */

export type NavIcon = React.ComponentType<{ className?: string }>;

/** Badge counters resolved at render time by the sidebar's pollers. */
export type BadgeKey =
  | "devices"
  | "complaints"
  | "review:em"
  | "review:ae"
  | "review:me";

/** Small trailing tag. "ceo" = locked to SUPER_ADMIN, "admin" = admin surface. */
export type NavPill = "ceo" | "admin";

export type NavItem = {
  /** Stable, unique within the whole tree. Used as the React key and the
   *  open/closed persistence key for parents. */
  id: string;
  title: string;
  icon: NavIcon;
  /** Leaf items link somewhere; parents have children instead. */
  href?: string;
  children?: NavItem[];
  badge?: BadgeKey;
  pill?: NavPill;
  /** Shown in the ⌘K palette to disambiguate same-named entries. */
  context?: string;
};

export type NavGroup = {
  id: string;
  heading?: string;
  items: NavItem[];
};

export type PartnerTeamInfo = {
  id: string;
  name: string;
  departmentName: string;
};

export type NavUser = {
  name: string;
  email: string;
  role: string;
  employeeId: string;
  officeId?: string;
  officeName?: string;
  isPrimaryOffice?: boolean;
  partnerTeams?: PartnerTeamInfo[];
};

function hasAccess(roles: string[], userRole: string) {
  return roles.includes("all") || roles.includes(userRole);
}

type RoleItem = {
  title: string;
  href: string;
  icon: NavIcon;
  roles: string[];
  badge?: BadgeKey;
  pill?: NavPill;
};

/** Filters a role-gated list and converts it to NavItems keyed by href. */
function resolve(items: RoleItem[], userRole: string, idPrefix: string): NavItem[] {
  return items
    .filter((item) => hasAccess(item.roles, userRole))
    .map((item) => ({
      id: `${idPrefix}:${item.href}`,
      title: item.title,
      icon: item.icon,
      href: item.href,
      badge: item.badge,
      pill: item.pill,
    }));
}

function mainNav(): RoleItem[] {
  return [
    { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["all"] },
    { title: "Daily Activities", href: "/fines", icon: CalendarClock, roles: ["all"] },
    { title: "Attendance Calendar", href: "/attendance", icon: CalendarDays, roles: ["EMPLOYEE", "MANAGER"] },
    { title: "My Reports", href: "/my-reports", icon: BarChart3, roles: ["EMPLOYEE", "MANAGER"] },
    { title: "Attendance Calendar", href: "/attendance-calendar", icon: CalendarDays, roles: ["SUPER_ADMIN", "PARTNER"] },
    { title: "Complaints", href: "/complaints", icon: AlertOctagon, roles: ["all"], badge: "complaints" },
  ];
}

const managementNav: RoleItem[] = [
  { title: "Employees", href: "/employees", icon: Users, roles: ["SUPER_ADMIN", "PARTNER"] },
  { title: "Departments", href: "/departments", icon: Building2, roles: ["SUPER_ADMIN"] },
  { title: "Leave Management", href: "/leaves", icon: CalendarMinus, roles: ["SUPER_ADMIN", "PARTNER"] },
  { title: "Login Approvals", href: "/login-approvals", icon: ShieldCheck, roles: ["SUPER_ADMIN"], badge: "devices" },
];

const financeNav: RoleItem[] = [
  { title: "Payroll", href: "/payroll", icon: Wallet, roles: ["all"] },
];

const settingsNav: RoleItem[] = [
  { title: "Office Timings", href: "/settings", icon: Settings, roles: ["SUPER_ADMIN"] },
  { title: "How It Works", href: "/how-it-works", icon: HelpCircle, roles: ["all"] },
  { title: "Automated Messages", href: "/automated-messages", icon: MessageSquare, roles: ["SUPER_ADMIN"] },
];

/**
 * Shared Etsy items for a plain Etsy employee with no team section of their
 * own. Izaan (EM-4) owns shops himself AND leads the EM team, so his submit
 * surfaces are split out from his approval surfaces.
 */
function etsyNav(userRole: string, employeeId: string): RoleItem[] {
  const isAdminOrManager = userRole === "SUPER_ADMIN" || userRole === "MANAGER";
  const isPartner = userRole === "PARTNER";
  const isIzaan = userRole === "MANAGER" && employeeId === "EM-4";
  const isAdminLikeView = isAdminOrManager || isPartner;

  if (isIzaan) {
    return [
      { title: "Submit Review", href: "/my-reviews", icon: Star, roles: ["all"] },
      { title: "Submit Refund", href: "/my-refunds", icon: RefreshCcw, roles: ["all"] },
      { title: "Review Approvals", href: "/review-bonus", icon: Star, roles: ["all"] },
      { title: "Refunds", href: "/refunds", icon: RefreshCcw, roles: ["all"] },
      { title: "Bonus Guide", href: "/etsy-bonus-guide", icon: BookOpen, roles: ["all"] },
    ];
  }

  return [
    {
      title: isAdminLikeView ? "Review Approvals" : "Submit Review",
      href: "/review-bonus",
      icon: Star,
      roles: ["all"],
    },
    {
      title: isAdminLikeView ? "Refunds" : "Submit Refund",
      href: "/refunds",
      icon: RefreshCcw,
      roles: ["all"],
    },
    { title: "Bonus Guide", href: "/etsy-bonus-guide", icon: BookOpen, roles: ["all"] },
  ];
}

type TeamKey = "em" | "ae" | "me";

/**
 * One Etsy team's surfaces. `?team=` drives server-side scoping on every
 * page, so the CEO clicking "Refunds" under Awais sees only AE refunds.
 * Analytics is CEO + PARTNER only — Izaan is a team lead (MANAGER), and
 * /etsy-analytics blocks MANAGER server-side as a backstop.
 */
function teamItems(key: TeamKey, isIzaan: boolean, label: string): NavItem[] {
  const items: NavItem[] = [
    { id: `${key}:bonus`, title: "Bonus Program", icon: Target, href: `/bonus-program?team=${key}`, context: label },
  ];
  if (!isIzaan) {
    items.push({ id: `${key}:analytics`, title: "Analytics", icon: BarChart3, href: `/etsy-analytics?team=${key}`, context: label });
  }
  items.push(
    { id: `${key}:reports`, title: "Team Reports", icon: FileText, href: `/daily-work-report?team=${key}`, context: label },
    { id: `${key}:reviews`, title: "Review Approvals", icon: Star, href: `/review-bonus?team=${key}`, badge: `review:${key}` as BadgeKey, context: label },
    { id: `${key}:refunds`, title: "Refunds", icon: RefreshCcw, href: `/refunds?team=${key}`, context: label },
    { id: `${key}:guide`, title: "Bonus Guide", icon: BookOpen, href: "/etsy-bonus-guide", context: label },
  );
  return items;
}

function partnerSections(user: NavUser): NavItem[] {
  const isCeo = user.role === "SUPER_ADMIN";
  const isIzaan = user.role === "MANAGER" && user.employeeId === "EM-4";
  const partnerDeptHas = (suffix: string) =>
    user.partnerTeams?.some((t) => t.departmentName.includes(suffix)) ?? false;

  const sections: NavItem[] = [];

  if (isCeo || isIzaan || partnerDeptHas(" - EM")) {
    sections.push({
      id: "team:em",
      title: "Izaan (EM)",
      icon: Store,
      children: teamItems("em", isIzaan, "Izaan (EM)"),
    });
  }
  if (isCeo || partnerDeptHas(" - AE")) {
    sections.push({
      id: "team:ae",
      title: "Awais (AE)",
      icon: Store,
      children: teamItems("ae", false, "Awais (AE)"),
    });
  }
  if (isCeo || partnerDeptHas(" - ME")) {
    sections.push({
      id: "team:me",
      title: "Mubeen (ME)",
      icon: Store,
      children: teamItems("me", false, "Mubeen (ME)"),
    });
  }

  return sections;
}

/**
 * Etsy Tools group visibility — anyone on the Etsy side of the org.
 * FB-team employees (SMM-*) and the FB partner (Zain) never see it, which
 * mirrors the page guards.
 */
function showEtsyTools(user: NavUser): boolean {
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

  return Boolean(isCeo || isHrAdmin || isIzaan || isEtsyPartner || isEtsyEmployee);
}

export function buildNav(user: NavUser): NavGroup[] {
  const role = user.role;
  const employeeId = user.employeeId || "";
  const isCeo = role === "SUPER_ADMIN";
  const groups: NavGroup[] = [];

  // ── Overview (no heading — sits directly under the workspace card) ──
  groups.push({ id: "main", items: resolve(mainNav(), role, "main") });

  // ── Management ──
  const management = resolve(managementNav, role, "mgmt");
  if (management.length > 0) {
    groups.push({ id: "management", heading: "Management", items: management });
  }

  // ── Finance ──
  const finance = resolve(financeNav, role, "finance");
  if (finance.length > 0) {
    groups.push({ id: "finance", heading: "Finance", items: finance });
  }

  // ── Etsy Tools ──
  if (showEtsyTools(user)) {
    const tools: NavItem[] = [];
    // Autopilot analytics dashboard leads the group — the most-visited
    // admin surface during the EM rollout.
    if (isCeo) {
      tools.push({
        id: "tool:autopilot-dashboard",
        title: "Autopilot Dashboard",
        icon: BarChart3,
        href: "/seo-autopilot/dashboard",
        pill: "admin",
      });
    }
    tools.push({
      id: "tool:product-hunter",
      title: "Product Hunter",
      icon: Target,
      href: "/seo-autopilot/product-hunter",
    });
    // Product Validator / SEO Autopilot / Prompt Engineer are CEO-ONLY
    // (Aug 6 2026 directive). Hidden from everyone else so nobody clicks
    // into a dead end; the pages and APIs enforce the same lock.
    if (isCeo) {
      tools.push({
        id: "tool:product-validator",
        title: "Product Validator",
        icon: ShieldCheck,
        href: "/product-validator",
        pill: "ceo",
      });
    }
    tools.push({
      id: "tool:price-calculator",
      title: "Price Calculator",
      icon: Calculator,
      href: "/price-calculator",
    });
    if (isCeo) {
      tools.push({
        id: "tool:seo-autopilot",
        title: "SEO Autopilot",
        icon: Sparkles,
        href: "/seo-autopilot",
        pill: "ceo",
      });
      tools.push({
        id: "tool:prompt-engineer",
        title: "Prompt Engineer",
        icon: Wand2,
        href: "/prompt-engineer",
        pill: "ceo",
      });
    }
    groups.push({ id: "etsy-tools", heading: "Etsy Tools", items: tools });
  }

  // ── My Shops — personal submit surfaces ──
  //
  // Izaan (EM-4) leads the EM team AND owns Etsy shops himself. His
  // /review-bonus and /refunds are the team APPROVAL inboxes, so his own
  // claims live on dedicated pages. Those two pages hard-redirect anybody
  // who isn't him (SUPER_ADMIN and PARTNER included), so this group must
  // stay Izaan-only or it would hand people a link that bounces.
  //
  // Added Aug 8 2026: the pages existed but had no sidebar entry for any
  // role — the old getEtsyNav() branch that would have shown them was
  // unreachable, because it only ran for Etsy employees with no team
  // section, and Izaan always has one.
  const isIzaanLead = role === "MANAGER" && employeeId === "EM-4";
  if (isIzaanLead) {
    groups.push({
      id: "my-shops",
      heading: "My Shops",
      items: [
        { id: "mine:reviews", title: "Submit Review", icon: Star, href: "/my-reviews" },
        { id: "mine:refunds", title: "Submit Refund", icon: RefreshCcw, href: "/my-refunds" },
      ],
    });
  }

  // ── Per-team sections (collapsible) ──
  const teams = partnerSections(user);
  if (teams.length > 0) {
    groups.push({ id: "teams", heading: "Teams", items: teams });
  }

  // ── Shared Etsy group — plain Etsy employees with no team section ──
  const isEtsyEmployee =
    teams.length === 0 &&
    (employeeId.startsWith("EM") ||
      employeeId.startsWith("AE") ||
      employeeId.startsWith("ME")) &&
    employeeId !== "EM-4L";
  if (isEtsyEmployee) {
    const items = resolve(etsyNav(role, employeeId), role, "etsy");
    if (items.length > 0) {
      groups.push({ id: "etsy", heading: "Etsy", items });
    }
  }

  // ── FB Program ──
  // Bonus Program: CEO + SMM-* (Zain excluded — "FB is simple").
  // HQ reports: CEO only (HQ has no partner, Wasif runs it directly).
  // Zain reports: CEO + Zain.
  {
    const isSmm = employeeId.startsWith("SMM");
    const isZain =
      role === "PARTNER" &&
      (user.partnerTeams?.some((t) => t.departmentName.includes(" - O2")) ?? false);

    const fb: NavItem[] = [];
    if (isCeo || isSmm) {
      fb.push({ id: "fb:bonus", title: "Bonus Program", icon: Rocket, href: "/fb-program" });
    }
    if (isCeo) {
      fb.push({ id: "fb:hq", title: "HQ Team Reports", icon: FileText, href: "/daily-work-report?team=fb-hq" });
    }
    if (isCeo || isZain) {
      fb.push({ id: "fb:o2", title: "Zain Team Reports", icon: FileText, href: "/daily-work-report?team=fb-o2" });
    }
    if (fb.length > 0) {
      groups.push({ id: "fb", heading: "FB Program", items: fb });
    }
  }

  // ── Settings ──
  const settings = resolve(settingsNav, role, "settings");
  if (settings.length > 0) {
    groups.push({ id: "settings", heading: "Settings", items: settings });
  }

  return groups;
}

/** Every leaf (linkable) item in the tree, for the ⌘K palette. */
export function flattenNav(groups: NavGroup[]): (NavItem & { href: string; group?: string })[] {
  const out: (NavItem & { href: string; group?: string })[] = [];
  for (const group of groups) {
    const walk = (items: NavItem[], parentLabel?: string) => {
      for (const item of items) {
        if (item.children) {
          walk(item.children, item.title);
        } else if (item.href) {
          out.push({ ...item, href: item.href, group: item.context ?? parentLabel ?? group.heading });
        }
      }
    };
    walk(group.items);
  }
  return out;
}

/**
 * Human label for a pathname, used by the header breadcrumb. Falls back to a
 * title-cased version of the last path segment so a new page never renders a
 * blank crumb.
 */
export const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/fines": "Daily Activities",
  "/attendance": "Attendance Calendar",
  "/attendance-calendar": "Attendance Calendar",
  "/my-reports": "My Reports",
  "/complaints": "Complaints",
  "/employees": "Employees",
  "/departments": "Departments",
  "/leaves": "Leave Management",
  "/login-approvals": "Login Approvals",
  "/payroll": "Payroll",
  "/bonus-program": "Bonus Program",
  "/etsy-analytics": "Analytics",
  "/daily-work-report": "Team Reports",
  "/review-bonus": "Review Approvals",
  "/refunds": "Refunds",
  "/my-reviews": "Submit Review",
  "/my-refunds": "Submit Refund",
  "/etsy-bonus-guide": "Bonus Guide",
  "/seo-autopilot": "SEO Autopilot",
  "/seo-autopilot/dashboard": "Autopilot Dashboard",
  "/seo-autopilot/product-hunter": "Product Hunter",
  "/product-validator": "Product Validator",
  "/price-calculator": "Price Calculator",
  "/prompt-engineer": "Prompt Engineer",
  "/fb-program": "Bonus Program",
  "/settings": "Office Timings",
  "/how-it-works": "How It Works",
  "/automated-messages": "Automated Messages",
  "/notifications": "Notifications",
  "/announcements": "Announcements",
  "/profile": "My Profile",
  "/warnings": "Warnings",
  "/incentives": "Incentives",
  "/reports": "Reports",
};

export function routeTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  // Longest-prefix match handles detail routes like /employees/<id>.
  const prefixes = Object.keys(ROUTE_TITLES)
    .filter((p) => pathname.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length);
  if (prefixes.length > 0) return ROUTE_TITLES[prefixes[0]];

  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
