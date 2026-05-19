import { prisma } from "@/lib/prisma";

export type EtsyTeamKey = "em" | "ae" | "me";

const TEAM_KEY_TO_DEPT_NAME: Record<EtsyTeamKey, string> = {
  em: "Etsy - EM",
  ae: "Etsy - AE",
  me: "Etsy - ME",
};

const VALID_KEYS: EtsyTeamKey[] = ["em", "ae", "me"];

export function isEtsyTeamKey(value: string | null | undefined): value is EtsyTeamKey {
  return !!value && (VALID_KEYS as string[]).includes(value);
}

export interface EtsyScope {
  departmentId: string;
  departmentName: string;
  teamKey: EtsyTeamKey;
  // Per-team employee exclusions (e.g. EM team excludes Izaan + EM-4L).
  // AE / ME have no exclusions because the partner isn't on payroll.
  employeeIdExclusions: string[];
}

function deptNameToKey(name: string): EtsyTeamKey | null {
  if (name.includes(" - AE")) return "ae";
  if (name.includes(" - ME")) return "me";
  if (name.includes(" - EM") || name === "Etsy") return "em";
  return null;
}

/**
 * Resolve which Etsy department a viewer is allowed to see.
 *
 * - SUPER_ADMIN: obeys teamKey query (em/ae/me); falls back to EM if absent
 *   so legacy URLs (no param) keep working.
 * - MANAGER (Izaan): always EM, regardless of teamKey.
 * - PARTNER (Awais/Mubeen): always own team; returns null for non-Etsy
 *   partners (e.g. Zain on Facebook).
 *
 * Returns null when the resolved scope doesn't exist or is not Etsy-flavored.
 */
export async function resolveEtsyScope(
  role: string,
  userId: string,
  teamKey?: string | null
): Promise<EtsyScope | null> {
  if (role === "PARTNER") {
    const team = await prisma.team.findFirst({
      where: { partnerId: userId },
      select: { department: { select: { id: true, name: true } } },
    });
    if (!team?.department) return null;
    if (!team.department.name.toLowerCase().includes("etsy")) return null;
    const key = deptNameToKey(team.department.name);
    if (!key) return null;
    return {
      departmentId: team.department.id,
      departmentName: team.department.name,
      teamKey: key,
      employeeIdExclusions: [],
    };
  }

  if (role === "MANAGER") {
    const dept = await prisma.department.findFirst({
      where: { office: { isPrimary: true }, OR: [{ name: "Etsy - EM" }, { name: "Etsy" }] },
      select: { id: true, name: true },
    });
    if (!dept) return null;
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      teamKey: "em",
      // EM-4L (Abdullah, non-Etsy ecom) is the only exclusion. EM-4 (Izaan)
      // USED to be excluded because he was team-lead-only, but as of
      // May 19 2026 he runs his own shops alongside managing the team, so
      // he gets his own row in the bonus list — same 7-criteria scoring
      // as everyone else. The team-lead-bonus tally still filters EM-4 out
      // (see /api/bonus-eligibility line ~215 and the BonusProgramView
      // `eligibleCount` reducer) so his own row never inflates his
      // team-lead payout.
      employeeIdExclusions: ["EM-4L"],
    };
  }

  // SUPER_ADMIN — obey query param; default to EM.
  const requested: EtsyTeamKey = isEtsyTeamKey(teamKey) ? teamKey : "em";

  if (requested === "em") {
    const dept = await prisma.department.findFirst({
      where: { office: { isPrimary: true }, OR: [{ name: "Etsy - EM" }, { name: "Etsy" }] },
      select: { id: true, name: true },
    });
    if (!dept) return null;
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      teamKey: "em",
      // EM-4 (Izaan) now appears in the EM bonus list — see comment in the
      // MANAGER branch above. Only EM-4L stays out.
      employeeIdExclusions: ["EM-4L"],
    };
  }

  const dept = await prisma.department.findFirst({
    where: { name: TEAM_KEY_TO_DEPT_NAME[requested] },
    select: { id: true, name: true },
  });
  if (!dept) return null;
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    teamKey: requested,
    employeeIdExclusions: [],
  };
}
