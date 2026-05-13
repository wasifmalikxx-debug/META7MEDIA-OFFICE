/**
 * Dashboard financial aggregation.
 *
 * Takes the raw snapshot rows + refund rows fetched by the dashboard page
 * and computes the rich data structure both the CEO dashboard and the
 * partner dashboard consume: per-team today/MTD/MoM aggregates, combined
 * roll-ups, daily series for the trend chart, and refunds context.
 *
 * Pure data transformation — no DB or network calls. Caller fetches once
 * and feeds in; we return everything the UI needs.
 */

import type { DailyTeamSnapshot } from "@prisma/client";

/**
 * Minimal refund row shape the aggregator needs. Lets the caller select
 * down to just these fields (smaller query payload) without TS complaining
 * about missing notes / proofUrl / etc.
 */
export interface RefundLite {
  id: string;
  userId: string;
  createdAt: Date;
  etsyRefundAmount: number;
  aliexpressRefunded: boolean;
  aliexpressAmount: number | null;
  user?: { department?: { name: string | null } | null } | null;
}

export type TeamKey = "em" | "ae" | "me" | "fb-hq" | "fb-o2";

const ALL_TEAM_KEYS: TeamKey[] = ["em", "ae", "me", "fb-hq", "fb-o2"];

export interface MoneyBlock {
  orders: number;
  sale: number;
  cost: number;
  profit: number;
}

export interface RefundBlock {
  count: number;
  loss: number;       // sum of etsyRefundAmount
  recovered: number;  // sum of aliexpressAmount where aliexpressRefunded
}

export interface TeamFinancials {
  teamKey: TeamKey;
  teamName: string | null;
  departmentName: string | null;
  officeSlug: string | null;
  today: MoneyBlock;
  mtd: MoneyBlock;
  /** Same first-N-days slice of last month, for fair MoM comparison. */
  lastMonthSameDay: MoneyBlock;
  /** Full last month — used when the user explicitly compares totals. */
  lastMonthFull: MoneyBlock;
  refundsMtd: RefundBlock;
  refundsLastMonth: RefundBlock;
}

export interface DailySeriesPoint {
  date: string; // YYYY-MM-DD
  sale: number;
  profit: number;
  orders: number;
}

export interface FinancialsResult {
  perTeam: TeamFinancials[];
  combined: Omit<TeamFinancials, "teamKey" | "teamName" | "departmentName" | "officeSlug">;
  dailySeries: DailySeriesPoint[];
  /** YYYY-MM-DD of today (PKT) for chart anchoring. */
  todayISO: string;
}

// ─────────────────────────── helpers ───────────────────────────

const EMPTY_MONEY: MoneyBlock = { orders: 0, sale: 0, cost: 0, profit: 0 };
const EMPTY_REFUNDS: RefundBlock = { count: 0, loss: 0, recovered: 0 };

function addMoney(a: MoneyBlock, b: MoneyBlock): MoneyBlock {
  return {
    orders: a.orders + b.orders,
    sale: a.sale + b.sale,
    cost: a.cost + b.cost,
    profit: a.profit + b.profit,
  };
}
function addRefunds(a: RefundBlock, b: RefundBlock): RefundBlock {
  return {
    count: a.count + b.count,
    loss: a.loss + b.loss,
    recovered: a.recovered + b.recovered,
  };
}

/**
 * Map a department.name to its teamKey. Same logic as the snapshot service
 * so the two stay in lockstep. Returns null for FB depts that we don't
 * track refunds against (FB orders aren't on Etsy sheets).
 */
function refundTeamKey(deptName: string | null | undefined): TeamKey | null {
  if (!deptName) return null;
  const s = deptName.trim();
  if (s.endsWith(" - EM")) return "em";
  if (s.endsWith(" - AE")) return "ae";
  if (s.endsWith(" - ME")) return "me";
  return null;
}

/** ISO date (YYYY-MM-DD) for a PKT-shifted moment in time. */
function isoFromPkt(pktNow: Date): string {
  return pktNow.toISOString().slice(0, 10);
}

/** Compare two Date objects by their date portion only (UTC). */
function sameDateUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function snapToMoney(s: DailyTeamSnapshot): MoneyBlock {
  return {
    orders: s.orders,
    sale: s.totalSale,
    cost: s.totalCost,
    profit: s.grossProfit,
  };
}

// ─────────────────────────── main ───────────────────────────

/**
 * Build the dashboard financials object.
 *
 * @param snapshots  Every DailyTeamSnapshot row spanning last-month-start
 *                   to today (or beyond). Caller already filtered.
 * @param refunds    Every Refund row spanning last-month-start to now.
 *                   Each row must include `user.department.name` so we
 *                   can group by team.
 * @param month      Current month (1–12, PKT).
 * @param year       Current year (PKT).
 * @param pktNow     Current PKT date as a Date object.
 * @param scopeTeams Optional list of team keys to include (partner
 *                   dashboard passes ["ae"] or ["me"] etc). Defaults
 *                   to all 5 teams when omitted.
 */
export function buildDashboardFinancials(
  snapshots: DailyTeamSnapshot[],
  refunds: RefundLite[],
  month: number,
  year: number,
  pktNow: Date,
  scopeTeams?: TeamKey[],
): FinancialsResult {
  const teamsInScope = scopeTeams ?? ALL_TEAM_KEYS;

  // Date bookends (all UTC midnight).
  const todayISO = isoFromPkt(pktNow);
  const dayOfMonth = pktNow.getUTCDate();
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0));
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastMonthYear = month === 1 ? year - 1 : year;
  const lastMonthStart = new Date(Date.UTC(lastMonthYear, lastMonth - 1, 1));
  const lastMonthSameDayEnd = new Date(
    Date.UTC(lastMonthYear, lastMonth - 1, dayOfMonth),
  );
  const lastMonthEnd = new Date(Date.UTC(lastMonthYear, lastMonth, 0));

  // Index snapshots by team.
  const snapsByTeam = new Map<TeamKey, DailyTeamSnapshot[]>();
  for (const s of snapshots) {
    const k = s.teamKey as TeamKey;
    if (!teamsInScope.includes(k)) continue;
    const arr = snapsByTeam.get(k) ?? [];
    arr.push(s);
    snapsByTeam.set(k, arr);
  }

  // Index refunds by team.
  const refundsByTeam = new Map<TeamKey, typeof refunds>();
  for (const r of refunds) {
    const k = refundTeamKey(r.user?.department?.name);
    if (!k || !teamsInScope.includes(k)) continue;
    const arr = refundsByTeam.get(k) ?? [];
    arr.push(r);
    refundsByTeam.set(k, arr);
  }

  function aggregateMoney(
    snaps: DailyTeamSnapshot[],
    fromInclusive: Date,
    toInclusive: Date,
  ): MoneyBlock {
    let acc: MoneyBlock = { ...EMPTY_MONEY };
    for (const s of snaps) {
      const d = s.date;
      if (d >= fromInclusive && d <= toInclusive) {
        acc = addMoney(acc, snapToMoney(s));
      }
    }
    return acc;
  }
  function aggregateRefunds(
    rs: typeof refunds,
    fromInclusive: Date,
    toExclusive: Date,
  ): RefundBlock {
    let acc: RefundBlock = { ...EMPTY_REFUNDS };
    for (const r of rs) {
      const t = r.createdAt;
      if (t >= fromInclusive && t < toExclusive) {
        acc = {
          count: acc.count + 1,
          loss: acc.loss + r.etsyRefundAmount,
          recovered:
            acc.recovered +
            (r.aliexpressRefunded && r.aliexpressAmount ? r.aliexpressAmount : 0),
        };
      }
    }
    return acc;
  }

  // PKT-today for the "today" slice. Snapshot dates are date-only UTC,
  // so we compare against a same-shape Date.
  const todayUtcMidnight = new Date(Date.UTC(year, month - 1, dayOfMonth));

  const perTeam: TeamFinancials[] = teamsInScope.map((teamKey) => {
    const snaps = snapsByTeam.get(teamKey) ?? [];
    const rs = refundsByTeam.get(teamKey) ?? [];
    // Carry team metadata from any snapshot row (cron stamps these).
    const meta = snaps[0] ?? null;

    // "Today" — snapshots whose date matches todayUtcMidnight exactly.
    let today: MoneyBlock = { ...EMPTY_MONEY };
    for (const s of snaps) {
      if (sameDateUTC(s.date, todayUtcMidnight)) {
        today = addMoney(today, snapToMoney(s));
      }
    }

    const mtd = aggregateMoney(snaps, startOfMonth, endOfMonth);
    const lastMonthSameDay = aggregateMoney(
      snaps,
      lastMonthStart,
      lastMonthSameDayEnd,
    );
    const lastMonthFull = aggregateMoney(snaps, lastMonthStart, lastMonthEnd);

    const refundsMtd = aggregateRefunds(
      rs,
      startOfMonth,
      // exclusive — anything before next-month-start counts
      new Date(Date.UTC(year, month, 1)),
    );
    const refundsLastMonth = aggregateRefunds(
      rs,
      lastMonthStart,
      new Date(Date.UTC(lastMonthYear, lastMonth, 1)),
    );

    return {
      teamKey,
      teamName: meta?.teamName ?? null,
      departmentName: meta?.departmentName ?? null,
      officeSlug: meta?.officeSlug ?? null,
      today,
      mtd,
      lastMonthSameDay,
      lastMonthFull,
      refundsMtd,
      refundsLastMonth,
    };
  });

  // Combined roll-up across all teams in scope.
  const combined = perTeam.reduce(
    (acc, t) => ({
      today: addMoney(acc.today, t.today),
      mtd: addMoney(acc.mtd, t.mtd),
      lastMonthSameDay: addMoney(acc.lastMonthSameDay, t.lastMonthSameDay),
      lastMonthFull: addMoney(acc.lastMonthFull, t.lastMonthFull),
      refundsMtd: addRefunds(acc.refundsMtd, t.refundsMtd),
      refundsLastMonth: addRefunds(acc.refundsLastMonth, t.refundsLastMonth),
    }),
    {
      today: { ...EMPTY_MONEY },
      mtd: { ...EMPTY_MONEY },
      lastMonthSameDay: { ...EMPTY_MONEY },
      lastMonthFull: { ...EMPTY_MONEY },
      refundsMtd: { ...EMPTY_REFUNDS },
      refundsLastMonth: { ...EMPTY_REFUNDS },
    },
  );

  // Daily series for the trend chart — last 30 days inclusive of today,
  // combined across all teams in scope, zero-filled for empty days.
  const dailyMap = new Map<string, DailySeriesPoint>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(pktNow);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = isoFromPkt(d);
    dailyMap.set(iso, { date: iso, sale: 0, profit: 0, orders: 0 });
  }
  for (const s of snapshots) {
    if (!teamsInScope.includes(s.teamKey as TeamKey)) continue;
    const iso = isoFromPkt(s.date);
    const point = dailyMap.get(iso);
    if (!point) continue;
    point.sale += s.totalSale;
    point.profit += s.grossProfit;
    point.orders += s.orders;
  }
  const dailySeries = [...dailyMap.values()];

  return { perTeam, combined, dailySeries, todayISO };
}

/** Percent change b vs a, null when a is 0 (avoid division-by-zero). */
export function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}
