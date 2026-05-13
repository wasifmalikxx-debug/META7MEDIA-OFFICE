/**
 * Dashboard daily snapshot service.
 *
 * Reads every Etsy employee's monthly sheet, groups the rows by (date,
 * team), and upserts one DailyTeamSnapshot row per (date, team). The
 * CEO dashboard then queries this table directly instead of pulling
 * live sheet data on every page load.
 *
 * Why pre-compute:
 *   Cold sheet reads take 30–60s for the full 25-employee batch. We
 *   already do that work in the daily-report cron — this service
 *   piggybacks on the same fetch, so adding snapshots costs ~0 extra
 *   API quota.
 *
 * Order-count dedup uses the same canonical-id pattern as the analytics
 * route: `${employeeId}:${orderId}` for rows that have an order ID,
 * `${employeeId}:r${i}` synthetic for rows without one. Same dedup
 * rules as the analytics page so the numbers always agree.
 */

import { prisma } from "@/lib/prisma";
import {
  fetchAllSheetAnalytics,
  type SheetOrderRow,
} from "./google-sheets.service";

export type TeamKey = "em" | "ae" | "me" | "fb-hq" | "fb-o2";

/**
 * Map a department.name to its short teamKey.
 * "Etsy - EM" → "em", "Facebook - HQ" → "fb-hq", etc.
 * Returns null for unknown names (we ignore them).
 */
export function teamKeyFromDept(deptName: string | null | undefined): TeamKey | null {
  if (!deptName) return null;
  const s = deptName.trim();
  if (s.endsWith(" - EM")) return "em";
  if (s.endsWith(" - AE")) return "ae";
  if (s.endsWith(" - ME")) return "me";
  if (s.endsWith(" - HQ")) return "fb-hq";
  if (s.endsWith(" - O2")) return "fb-o2";
  return null;
}

/**
 * Parse a date string from the sheet into ISO YYYY-MM-DD. Accepts every
 * format the analytics route handles ("5 May", "May 5", "5/5/2026",
 * "5 May 2026"). Returns null if the parsed month doesn't match the
 * expected month — defensive against rows from other tabs / typos.
 */
function parseRowDate(raw: string, expectedMonth: number, expectedYear: number): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  const monthMap: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };

  // "5 May", "5 May 2026", "5-May", "5-May-2026"
  const dmy = cleaned.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)(?:[\s\-]+(\d{2,4}))?$/);
  if (dmy) {
    const day = parseInt(dmy[1]);
    const m = monthMap[dmy[2].toLowerCase()];
    const yr = dmy[3]
      ? parseInt(dmy[3]) < 100 ? 2000 + parseInt(dmy[3]) : parseInt(dmy[3])
      : expectedYear;
    if (m === expectedMonth && yr === expectedYear && day >= 1 && day <= 31) {
      return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // "May 5", "May 5 2026"
  const mdy = cleaned.match(/^([A-Za-z]+)[\s\-]+(\d{1,2})(?:[\s\-]+(\d{2,4}))?$/);
  if (mdy) {
    const m = monthMap[mdy[1].toLowerCase()];
    const day = parseInt(mdy[2]);
    const yr = mdy[3]
      ? parseInt(mdy[3]) < 100 ? 2000 + parseInt(mdy[3]) : parseInt(mdy[3])
      : expectedYear;
    if (m === expectedMonth && yr === expectedYear && day >= 1 && day <= 31) {
      return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // "5/5/2026" — try both M/D/Y and D/M/Y
  const slash = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const a = parseInt(slash[1]);
    const b = parseInt(slash[2]);
    const yr = parseInt(slash[3]) < 100 ? 2000 + parseInt(slash[3]) : parseInt(slash[3]);
    if (yr === expectedYear) {
      if (a === expectedMonth) return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
      if (b === expectedMonth) return `${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    }
  }

  return null;
}

interface PerDayPerTeamBucket {
  totalSale: number;
  totalCost: number;
  afterTax: number;
  /** Deduped canonical order IDs — Set so multi-SKU rows collapse correctly. */
  orderIds: Set<string>;
}

interface SnapshotMeta {
  teamName: string | null;
  departmentName: string;
  officeSlug: string | null;
}

/**
 * Build + upsert snapshots for a single month.
 *
 * Pass the same {month, year} you'd give the analytics route. The
 * function:
 *   1. Pulls every Etsy employee with a sheet
 *   2. Fetches all their order rows for that month
 *   3. Buckets them by (date, teamKey)
 *   4. Upserts one DailyTeamSnapshot row per bucket
 *
 * Returns counts so the caller can log + verify.
 */
export async function buildSnapshotsForMonth(
  month: number,
  year: number,
): Promise<{ rowsUpserted: number; daysCovered: number; teamsCovered: number }> {
  // 1. Etsy employees only — FB teams don't have sheets to read.
  const employees = await prisma.user.findMany({
    where: {
      googleSheetUrl: { not: null },
      department: {
        name: { in: ["Etsy - EM", "Etsy - AE", "Etsy - ME"] },
      },
    },
    select: {
      id: true,
      googleSheetUrl: true,
      department: { select: { id: true, name: true } },
    },
  });

  if (employees.length === 0) {
    return { rowsUpserted: 0, daysCovered: 0, teamsCovered: 0 };
  }

  // 2. Pull all sheet data in parallel (3 concurrent — same as cron).
  const sheetData = await fetchAllSheetAnalytics(
    employees.map((e) => ({ userId: e.id, sheetUrl: e.googleSheetUrl! })),
    month,
    year,
  );

  // 3. Metadata lookup — team name + office slug per team key, fetched
  //    once and reused across all buckets.
  const departments = await prisma.department.findMany({
    where: { name: { in: ["Etsy - EM", "Etsy - AE", "Etsy - ME"] } },
    select: {
      name: true,
      office: { select: { slug: true } },
      teams: { select: { name: true }, take: 1 },
    },
  });
  const metaByTeamKey = new Map<TeamKey, SnapshotMeta>();
  for (const d of departments) {
    const key = teamKeyFromDept(d.name);
    if (!key) continue;
    metaByTeamKey.set(key, {
      teamName: d.teams[0]?.name ?? null,
      departmentName: d.name,
      officeSlug: d.office?.slug ?? null,
    });
  }

  // 4. Bucket rows by (date, teamKey).
  const buckets = new Map<string, PerDayPerTeamBucket>(); // key = `${date}|${teamKey}`

  for (const emp of employees) {
    const data = sheetData[emp.id];
    if (!data || !data.orders.length) continue;
    const teamKey = teamKeyFromDept(emp.department?.name);
    if (!teamKey) continue;

    let syntheticIdx = 0;
    for (const row of data.orders) {
      const dateStr = parseRowDate(row.orderDate, month, year);
      if (!dateStr) continue;

      const bucketKey = `${dateStr}|${teamKey}`;
      let b = buckets.get(bucketKey);
      if (!b) {
        b = { totalSale: 0, totalCost: 0, afterTax: 0, orderIds: new Set() };
        buckets.set(bucketKey, b);
      }
      b.totalSale += row.price;
      b.totalCost += row.cost;
      b.afterTax += row.afterTax;
      // Canonical id namespaces the order ID with the employee so two
      // employees can't collide on the same ID. Rows without an ID get
      // a synthetic per-employee, per-row id to stay distinct.
      const canonical = row.orderId
        ? `${emp.id}:${row.orderId}`
        : `${emp.id}:r${syntheticIdx++}`;
      b.orderIds.add(canonical);
    }
  }

  // 5. Upsert one row per bucket.
  const allDates = new Set<string>();
  const allTeams = new Set<TeamKey>();
  let rowsUpserted = 0;

  for (const [bucketKey, b] of buckets) {
    const [dateStr, teamKey] = bucketKey.split("|") as [string, TeamKey];
    allDates.add(dateStr);
    allTeams.add(teamKey);

    const meta = metaByTeamKey.get(teamKey);
    const grossProfit = b.totalSale - b.totalCost;

    await prisma.dailyTeamSnapshot.upsert({
      where: { date_teamKey: { date: new Date(dateStr), teamKey } },
      create: {
        date: new Date(dateStr),
        teamKey,
        teamName: meta?.teamName ?? null,
        departmentName: meta?.departmentName ?? null,
        officeSlug: meta?.officeSlug ?? null,
        orders: b.orderIds.size,
        totalSale: b.totalSale,
        totalCost: b.totalCost,
        grossProfit,
        afterTax: b.afterTax,
      },
      update: {
        teamName: meta?.teamName ?? null,
        departmentName: meta?.departmentName ?? null,
        officeSlug: meta?.officeSlug ?? null,
        orders: b.orderIds.size,
        totalSale: b.totalSale,
        totalCost: b.totalCost,
        grossProfit,
        afterTax: b.afterTax,
      },
    });
    rowsUpserted++;
  }

  return {
    rowsUpserted,
    daysCovered: allDates.size,
    teamsCovered: allTeams.size,
  };
}
