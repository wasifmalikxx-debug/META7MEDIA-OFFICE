import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { extractSheetId, normalizeTabName, getAlternativeTabNames } from "@/lib/services/google-sheets.service";
import { google } from "googleapis";
import path from "path";

export const dynamic = "force-dynamic";
// 5 minutes — the cron now reads ~24 sheets across EM/AE/ME, each requiring
// 3 Google Sheets API calls (tab list + headers + data). At 60s some teams
// got cut off before the CEO send fired. 300s is the Vercel Pro ceiling.
export const maxDuration = 300;

// Sheet IDs mapped to employee IDs
const SHEET_MAP: Record<string, string> = {
  "EM-1": "1JDOuuUMho1LnEDZFkk8x7K3cD0A0NFALGH3WuVqz-bo",
  "EM-2": "1kZCi5WbjjVqLwm_bijg-i74zIQxKmjCeRv3ORS-D0eU",
  "EM-3": "1MUpjkITaOp-yKM051v1lQqtFzLQVY0VZDAd9F6KBgZI",
  "EM-4B": "1SLlTv1b8wOPDkMBuNeFpgDZk3oi9OhQCB7enXzOJz6Y",
  "EM-5": "1iEebhf_OtMJJg8S0Oyuol9g_oOSuhUbEfTiwr8pLT5w",
  "EM-6": "1Nz1MeWZeeolbmks7GwT99TD7SFMXlmtHA_tXlqqyqpc",
  "EM-7": "1yKHQM8_FJofJcLr7VFAHbeWxKkwJhFKhiaEiwxAWw4Q",
  "EM-8": "1HC2ds9epnJp8zgq5FJkjLODF_1Bc4Xtnsp32jbbWSrg",
  "EM-9": "10pkeYRvmPFFDTFvTilANVeDw7-r0HvYy7m0Z2fkFdgM",
  "EM-10": "1X3s8bZ8z28p-Qu70-yoa4tGmdkLZWzFOB9vpDNdhXHc",
};

function parseDollar(val: string | undefined): number {
  if (!val) return 0;
  return parseFloat(val.replace(/[$,\s]/g, "")) || 0;
}

interface EmployeeReport {
  empId: string;
  name: string;
  // Today's numbers (filtered by date column match)
  todayOrders: number;
  todaySale: number;
  todayCost: number;
  todayProfit: number;
  // Month-to-date numbers (sum of every row in the current month tab)
  monthOrders: number;
  monthSale: number;
  monthCost: number;
  monthProfit: number;
}

// Lightweight today-match for sheet date cells. Partner sheets ship dates in
// many formats — "5 May", "5 May 2026", "May 5", "5/5/2026", "5-May" — and a
// strict string compare misses real orders. This walks the common shapes and
// returns true iff the cell represents today's date in PKT.
function isTodayCell(dateVal: string, todayPkt: Date): boolean {
  if (!dateVal) return false;
  const cleaned = dateVal.trim();
  const today = todayPkt.getUTCDate();
  const todayMonth = todayPkt.getUTCMonth(); // 0-indexed
  const todayYear = todayPkt.getUTCFullYear();
  const months: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };

  // "5 May", "5 May 2026", "5-May", "5-May-2026"
  const dmy = cleaned.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)(?:[\s\-]+(\d{2,4}))?$/);
  if (dmy) {
    const day = parseInt(dmy[1]);
    const monthIdx = months[dmy[2].toLowerCase()];
    const year = dmy[3] ? (parseInt(dmy[3]) < 100 ? 2000 + parseInt(dmy[3]) : parseInt(dmy[3])) : todayYear;
    if (day === today && monthIdx === todayMonth && year === todayYear) return true;
  }

  // "May 5", "May 5 2026", "May-5", "May-5-2026"
  const mdy = cleaned.match(/^([A-Za-z]+)[\s\-]+(\d{1,2})(?:[\s\-]+(\d{2,4}))?$/);
  if (mdy) {
    const monthIdx = months[mdy[1].toLowerCase()];
    const day = parseInt(mdy[2]);
    const year = mdy[3] ? (parseInt(mdy[3]) < 100 ? 2000 + parseInt(mdy[3]) : parseInt(mdy[3])) : todayYear;
    if (day === today && monthIdx === todayMonth && year === todayYear) return true;
  }

  // "5/5/2026" or "5-5-2026" — try both M/D/Y and D/M/Y
  const slash = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const a = parseInt(slash[1]);
    const b = parseInt(slash[2]);
    const yr = parseInt(slash[3]) < 100 ? 2000 + parseInt(slash[3]) : parseInt(slash[3]);
    if (yr === todayYear) {
      if (a === todayMonth + 1 && b === today) return true; // M/D/Y
      if (b === todayMonth + 1 && a === today) return true; // D/M/Y
    }
  }

  // Last resort: native Date parse
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    if (
      parsed.getUTCDate() === today &&
      parsed.getUTCMonth() === todayMonth &&
      parsed.getUTCFullYear() === todayYear
    ) return true;
  }

  return false;
}

/**
 * Read one employee's sheet and return today + month-to-date aggregates.
 *
 * Used by the partner-routing path so Awais/Mubeen's reports include all
 * members regardless of how each sheet is formatted. Tries every variant
 * of the month-tab name (MAY-2K26 / May 2K26 / MAY 2026 / etc.) so partner
 * sheets with inconsistent labeling still resolve. Date matching is also
 * format-tolerant.
 */
async function readEmployeeSheetReport(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
  month: number,
  year: number,
  todayPkt: Date
): Promise<{
  todayOrders: number; todaySale: number; todayCost: number; todayProfit: number;
  monthOrders: number; monthSale: number; monthCost: number; monthProfit: number;
}> {
  const empty = {
    todayOrders: 0, todaySale: 0, todayCost: 0, todayProfit: 0,
    monthOrders: 0, monthSale: 0, monthCost: 0, monthProfit: 0,
  };
  try {
    // Resolve which tab in this sheet corresponds to the requested month.
    // Try every alternative the analytics layer recognizes; first normalized
    // match wins. Empty/missing tab → return zeros.
    let actualTab: string | null = null;
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
      const candidates = getAlternativeTabNames(month, year).map(normalizeTabName);
      const candidateSet = new Set(candidates);
      const found = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
      if (found) actualTab = found;
    } catch {
      // Fall through — return empty zeros below if we can't list tabs.
    }
    if (!actualTab) return empty;

    // Pull the first 5 rows so we can locate the real header row. Some
    // partner sheets use Google's "Tables" feature which inserts a
    // `Table1_X` reference at A1, pushing the real headers down a row
    // (seen on AE-3). Scan for whichever row contains "ORDER DATE".
    const previewRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A1:N5`,
    });
    const previewRows = (previewRes.data.values || []) as string[][];

    let headerRowIdx = -1;
    for (let i = 0; i < previewRows.length; i++) {
      const row = (previewRows[i] || []).map((c) => (c || "").toString().toLowerCase().trim());
      if (row.some((c) => c.includes("order date") || c === "date")) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) return empty;

    const headers = (previewRows[headerRowIdx] || []).map((h) => (h || "").toString().toLowerCase().trim());
    const dateCol = headers.findIndex((h: string) => h.includes("order date") || h.includes("date"));
    const priceCol = headers.findIndex((h: string) => h.includes("price"));
    const costCol = headers.findIndex((h: string) => h.includes("cost"));
    // Order ID column varies in label across partner sheets — accept any
    // header that mentions "order number / order # / order id / ordder #
    // (typo seen on AE-5)". When present, used to dedupe multi-SKU rows
    // belonging to the same Etsy transaction.
    const orderIdCol = headers.findIndex(
      (h: string) =>
        h.includes("order number") ||
        h.includes("order #") ||
        h.includes("ordder #") ||
        h.includes("order id") ||
        h === "ae order"
    );
    if (dateCol === -1) return empty;

    // Data rows start one below the header row (1-indexed in the sheet).
    const dataStartRow = headerRowIdx + 2;
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A${dataStartRow}:N1000`,
    });
    const rows = dataRes.data.values || [];

    let todayOrders = 0, todaySale = 0, todayCost = 0;
    let monthOrders = 0, monthSale = 0, monthCost = 0;
    const monthOrderIds = new Set<string>();
    const todayOrderIds = new Set<string>();

    for (const row of rows) {
      const dateVal = (row[dateCol] || "").toString().trim();
      if (!dateVal) continue;
      const rowSale = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
      // Skip placeholder rows (date filled but no price entered yet) — partners
      // sometimes pre-stamp a date before logging the actual order details.
      if (rowSale <= 0) continue;
      const rowCost = costCol >= 0 ? parseDollar(row[costCol]) : 0;
      const orderId = orderIdCol >= 0 ? (row[orderIdCol] || "").toString().trim() : "";

      // Always sum revenue + cost — every line item contributes to the totals.
      monthSale += rowSale;
      monthCost += rowCost;
      // But increment the ORDER COUNT only when the order ID hasn't been
      // seen this month. SKU line items of the same Etsy transaction
      // collapse into one order. Rows without an orderId always count
      // (no way to know if they're dupes).
      if (!orderId || !monthOrderIds.has(orderId)) {
        monthOrders++;
        if (orderId) monthOrderIds.add(orderId);
      }

      if (isTodayCell(dateVal, todayPkt)) {
        todaySale += rowSale;
        todayCost += rowCost;
        if (!orderId || !todayOrderIds.has(orderId)) {
          todayOrders++;
          if (orderId) todayOrderIds.add(orderId);
        }
      }
    }

    // Gross profit = sale - cost. We DON'T sum the sheet's column literally
    // labeled "PROFIT" because in the Etsy templates that column is
    // (After Tax - Cost), i.e. net post-fee. Wasif wants gross profit on
    // every WhatsApp report, matching the analytics page change.
    return {
      todayOrders, todaySale, todayCost, todayProfit: todaySale - todayCost,
      monthOrders, monthSale, monthCost, monthProfit: monthSale - monthCost,
    };
  } catch {
    return empty;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return error("Unauthorized", 401);
  }

  // Check if today is Sunday in PKT — skip
  const pktNow = new Date(Date.now() + 5 * 60 * 60_000);
  const dayOfWeek = pktNow.getUTCDay();
  if (dayOfWeek === 0) {
    return json({ message: "Sunday — no report sent" });
  }

  try {
    let auth: InstanceType<typeof google.auth.GoogleAuth>;
    if (process.env.GOOGLE_CREDENTIALS) {
      auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });
    } else {
      auth = new google.auth.GoogleAuth({
        keyFile: path.join(process.cwd(), "google-credentials.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });
    }
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client as any });
    // PKT-relative reference values shared by every readEmployeeSheetReport()
    // call below — the helper does its own fuzzy tab + date matching from
    // these so we don't need a fixed tab string.
    const todayPkt = new Date(Date.now() + 5 * 60 * 60_000);
    const reportMonth = todayPkt.getUTCMonth() + 1;
    const reportYear = todayPkt.getUTCFullYear();

    // Get employee names from DB
    const employees = await prisma.user.findMany({
      where: { employeeId: { in: Object.keys(SHEET_MAP) } },
      select: { employeeId: true, firstName: true, lastName: true },
    });
    const nameMap: Record<string, string> = {};
    employees.forEach((e) => {
      nameMap[e.employeeId!] = `${e.firstName} ${e.lastName || ""}`.trim();
    });

    const reports: EmployeeReport[] = [];
    let allOrdersToday = 0, allSaleToday = 0, allCostToday = 0, allProfitToday = 0;
    let allOrdersMonth = 0, allSaleMonth = 0, allCostMonth = 0, allProfitMonth = 0;

    // Sort employee IDs naturally
    const sortedIds = Object.keys(SHEET_MAP).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 0;
      const numB = parseInt(b.replace(/\D/g, "")) || 0;
      return numA - numB;
    });

    // Read all EM employee sheets in parallel — much faster than serial
    // (each readEmployeeSheetReport makes 3 Sheets API calls; 10 sheets
    // sequentially eats most of the Vercel function timeout).
    const emResults = await Promise.all(
      sortedIds.map(async (empId) => ({
        empId,
        stats: await readEmployeeSheetReport(sheets, SHEET_MAP[empId], reportMonth, reportYear, todayPkt),
      }))
    );
    for (const { empId, stats } of emResults) {
      reports.push({
        empId,
        name: nameMap[empId] || empId,
        ...stats,
      });
      allOrdersToday += stats.todayOrders;
      allSaleToday += stats.todaySale;
      allCostToday += stats.todayCost;
      allProfitToday += stats.todayProfit;
      allOrdersMonth += stats.monthOrders;
      allSaleMonth += stats.monthSale;
      allCostMonth += stats.monthCost;
      allProfitMonth += stats.monthProfit;
    }

    // Build the message
    const now = nowPKT();
    const dateFormatted = `${now.getUTCDate()}/${now.getUTCMonth() + 1}/${now.getUTCFullYear()}`;
    const monthNamesFull = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const monthNameFormatted = `${monthNamesFull[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

    // Build the EM per-employee breakdown for {{19}} of the new CEO template.
    // Single-line, " | " separated. Every team member listed (not just today's
    // shippers) so the CEO sees idle members as well.
    const emBreakdownParts: string[] = [];
    for (const r of reports) {
      emBreakdownParts.push(
        r.todayOrders > 0
          ? `${r.empId}: ${r.todayOrders} ($${r.todaySale.toFixed(2)})`
          : `${r.empId}: 0`
      );
    }
    const emBreakdown = emBreakdownParts.length > 0 ? emBreakdownParts.join(" | ") : "No team members";

    const emTotals = {
      monthly: {
        orders: allOrdersMonth,
        sale: allSaleMonth,
        cost: allCostMonth,
        profit: allProfitMonth,
      },
      today: {
        orders: allOrdersToday,
        sale: allSaleToday,
        cost: allCostToday,
        profit: allProfitToday,
      },
      breakdown: emBreakdown,
    };

    const ceo = await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN" },
      select: { phone: true, phone2: true },
    });

    const { sendDailyReportTemplate, sendCeoCombinedTotalTemplate } = await import(
      "@/lib/services/whatsapp.service"
    );
    const sent: string[] = [];

    // ─── Partner reports (AE → Awais, ME → Mubeen) ─────────────────────
    // Each Etsy partner gets their team's daily_report (single-team, 11
    // params). We also stash each team's stats so we can fold them into
    // the CEO's combined message after this loop.
    const partnerReports: any[] = [];
    type TeamSummary = {
      monthly: { orders: number; sale: number; cost: number; profit: number };
      today: { orders: number; sale: number; cost: number; profit: number };
      breakdown: string;
    };
    const emptyTeam: TeamSummary = {
      monthly: { orders: 0, sale: 0, cost: 0, profit: 0 },
      today: { orders: 0, sale: 0, cost: 0, profit: 0 },
      breakdown: "No team members",
    };
    const partnerTeamStats: { ae?: TeamSummary; me?: TeamSummary } = {};
    try {
      const partners = await prisma.user.findMany({
        where: {
          role: "PARTNER",
          partnerTeams: {
            some: {
              department: { name: { startsWith: "Etsy - " } },
            },
          },
        },
        select: {
          id: true,
          firstName: true,
          phone: true,
          phone2: true,
          partnerTeams: {
            where: {
              department: { name: { startsWith: "Etsy - " } },
            },
            select: {
              department: { select: { name: true } },
              members: {
                where: {
                  status: { in: ["HIRED", "PROBATION"] },
                  googleSheetUrl: { not: null },
                },
                select: {
                  employeeId: true,
                  firstName: true,
                  lastName: true,
                  googleSheetUrl: true,
                },
              },
            },
          },
        },
      });

      for (const partner of partners) {
        if (!partner.phone && !partner.phone2) {
          partnerReports.push({ partner: partner.firstName, skipped: "no phone numbers" });
          continue;
        }

        const teamMembers = partner.partnerTeams.flatMap((t) => t.members);
        if (teamMembers.length === 0) {
          partnerReports.push({ partner: partner.firstName, skipped: "no members with sheets" });
          continue;
        }

        // Aggregate this team's numbers + per-employee breakdown.
        let tOrders = 0, tSale = 0, tCost = 0, tProfit = 0;
        let mOrders = 0, mSale = 0, mCost = 0, mProfit = 0;
        const breakdownParts: string[] = [];
        const memberStats: any[] = [];

        // Sort members by employeeId numeric suffix so the breakdown reads
        // AE-1, AE-2, AE-3 rather than alphabetic order.
        teamMembers.sort((a, b) => {
          const an = parseInt((a.employeeId || "").replace(/\D/g, "")) || 0;
          const bn = parseInt((b.employeeId || "").replace(/\D/g, "")) || 0;
          return an - bn;
        });

        // Parallel sheet reads — 7 employees in parallel finishes in ~3s
        // instead of ~21s sequentially. Still serial across teams so we
        // don't slam the Sheets API rate limit too hard.
        const memberResults = await Promise.all(
          teamMembers.map(async (member) => {
            const sheetId = member.googleSheetUrl ? extractSheetId(member.googleSheetUrl) : null;
            if (!sheetId) {
              return { member, stats: null as null | Awaited<ReturnType<typeof readEmployeeSheetReport>> };
            }
            const stats = await readEmployeeSheetReport(sheets, sheetId, reportMonth, reportYear, todayPkt);
            return { member, stats };
          })
        );

        for (const { member, stats } of memberResults) {
          if (!stats) {
            memberStats.push({ empId: member.employeeId, error: "invalid_sheet_url" });
            continue;
          }
          tOrders += stats.todayOrders;
          tSale += stats.todaySale;
          tCost += stats.todayCost;
          tProfit += stats.todayProfit;
          mOrders += stats.monthOrders;
          mSale += stats.monthSale;
          mCost += stats.monthCost;
          mProfit += stats.monthProfit;
          memberStats.push({ empId: member.employeeId, ...stats });
          // Show every member in the breakdown — partners want to see who's
          // shipping vs sitting at zero, not just today's actives. Compact
          // format keeps the Meta template parameter under length limits
          // (no \n / \t / >4 spaces — comma-only inline separators).
          breakdownParts.push(
            stats.todayOrders > 0
              ? `${member.employeeId}: ${stats.todayOrders} ($${stats.todaySale.toFixed(2)})`
              : `${member.employeeId}: 0`
          );
        }

        const teamSummary: TeamSummary = {
          monthly: { orders: mOrders, sale: mSale, cost: mCost, profit: mProfit },
          today: { orders: tOrders, sale: tSale, cost: tCost, profit: tProfit },
          breakdown: breakdownParts.length > 0 ? breakdownParts.join(" | ") : "No team members",
        };

        // Stash by team key so the CEO send below can fold AE + ME into the
        // combined block. Department name has the suffix (e.g. "Etsy - AE").
        const deptName = partner.partnerTeams[0]?.department?.name || "";
        if (deptName.includes(" - AE")) partnerTeamStats.ae = teamSummary;
        else if (deptName.includes(" - ME")) partnerTeamStats.me = teamSummary;

        const partnerPayload = {
          date: dateFormatted,
          monthName: monthNameFormatted,
          monthly: teamSummary.monthly,
          today: teamSummary.today,
          breakdown: teamSummary.breakdown,
        };

        const partnerSent: string[] = [];
        if (partner.phone) {
          await sendDailyReportTemplate(partner.phone, partnerPayload);
          partnerSent.push(partner.phone);
          sent.push(partner.phone);
        }
        if (partner.phone2) {
          await sendDailyReportTemplate(partner.phone2, partnerPayload);
          partnerSent.push(partner.phone2);
          sent.push(partner.phone2);
        }

        partnerReports.push({
          partner: partner.firstName,
          team: deptName,
          sentTo: partnerSent,
          today: teamSummary.today,
          monthly: teamSummary.monthly,
          members: memberStats,
        });
      }
    } catch (partnerErr: any) {
      console.error("[daily-report] partner block failed:", partnerErr?.message);
      partnerReports.push({ error: partnerErr?.message });
    }

    // ─── CEO 4-message daily sequence ───────────────────────────────────
    // Replaces the old single 37-param ceo_daily_summary blast (too long to
    // scan on a phone). The CEO now gets four focused messages:
    //
    //   1. EM team (daily_report template — 11 params, same as partners)
    //   2. AE team (daily_report)
    //   3. ME team (daily_report)
    //   4. All-offices combined total (ceo_combined_total — 10 params, no
    //      per-employee breakdown)
    //
    // 20-second gap between rounds so WhatsApp shows them as 4 separate
    // notifications instead of one batched "X new messages" group. Each
    // round sends to both phone + phone2 in parallel — total elapsed is
    // ~60s of waiting (3 gaps × 20s) plus ~8s of send latency, comfortably
    // under the 300s cron ceiling.
    //
    // Wrapped in a single try so a mid-sequence Meta failure doesn't poison
    // the rest of the cron response — partner sends already happened above.
    const ae = partnerTeamStats.ae ?? emptyTeam;
    const me = partnerTeamStats.me ?? emptyTeam;
    const combined = {
      monthly: {
        orders: emTotals.monthly.orders + ae.monthly.orders + me.monthly.orders,
        sale: emTotals.monthly.sale + ae.monthly.sale + me.monthly.sale,
        cost: emTotals.monthly.cost + ae.monthly.cost + me.monthly.cost,
        profit: emTotals.monthly.profit + ae.monthly.profit + me.monthly.profit,
      },
      today: {
        orders: emTotals.today.orders + ae.today.orders + me.today.orders,
        sale: emTotals.today.sale + ae.today.sale + me.today.sale,
        cost: emTotals.today.cost + ae.today.cost + me.today.cost,
        profit: emTotals.today.profit + ae.today.profit + me.today.profit,
      },
    };

    // CEO destination phones — both numbers receive every message.
    const ceoPhones: string[] = [];
    if (ceo?.phone) ceoPhones.push(ceo.phone);
    if (ceo?.phone2) ceoPhones.push(ceo.phone2);

    const ceoSent: string[] = [];
    let ceoError: string | null = null;
    try {
      // Build the four rounds in fixed order. The first three are per-team
      // (daily_report template), the fourth is the office-wide rollup
      // (ceo_combined_total). Labels use partner names instead of team
      // codes (EM/AE/ME) — Wasif reads these on his phone and "Izaan's
      // Team" parses faster at a glance than the internal department
      // shorthand.
      const teamRounds = [
        { label: "Izaan's Team", data: emTotals },
        { label: "Awais's Team", data: ae },
        { label: "Mubeen's Team", data: me },
      ];

      for (let i = 0; i < teamRounds.length; i++) {
        const round = teamRounds[i];
        const payload = {
          // Tag the date field with the team label so each of the 3 CEO
          // messages is immediately identifiable at the top. The
          // daily_report template body has "🗓 {{1}}" so this renders as
          // "🗓 Izaan's Team · May 11, 2026" — visible the moment the
          // message opens, no template re-submission required. Partner
          // sends keep the plain date (line 507) since each partner only
          // ever receives one team's report.
          date: `${round.label} · ${dateFormatted}`,
          monthName: monthNameFormatted,
          monthly: round.data.monthly,
          today: round.data.today,
          // Meta rejects empty / whitespace-only params. The aggregator
          // always populates breakdown (falling back to "No team members"
          // when a team has none), so this fallback is defensive only.
          breakdown: round.data.breakdown || "No activity today",
        };

        // Send to phone + phone2 in parallel — same content, different
        // recipient.
        await Promise.all(
          ceoPhones.map(async (phone) => {
            const ok = await sendDailyReportTemplate(phone, payload);
            if (ok && !ceoSent.includes(phone)) {
              ceoSent.push(phone);
              sent.push(phone);
            }
          }),
        );

        // Gap between team messages so WhatsApp surfaces each as its own
        // notification. No gap after the final team — the combined-total
        // send below has its own gap before it.
        if (i < teamRounds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 20_000));
        }
      }

      // 20s pause before the totals message so it lands separately from
      // the ME team message.
      if (teamRounds.length > 0 && ceoPhones.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }

      // Combined total — ceo_combined_total template (10 params, no
      // breakdown field).
      const totalPayload = {
        date: dateFormatted,
        monthName: monthNameFormatted,
        monthly: combined.monthly,
        today: combined.today,
      };
      await Promise.all(
        ceoPhones.map(async (phone) => {
          const ok = await sendCeoCombinedTotalTemplate(phone, totalPayload);
          if (ok && !ceoSent.includes(phone)) {
            ceoSent.push(phone);
            sent.push(phone);
          }
        }),
      );
    } catch (ceoErr: any) {
      ceoError = ceoErr?.message || String(ceoErr);
      console.error(
        "[daily-report] CEO 4-message sequence failed mid-flight:",
        ceoError,
      );
    }

    return json({
      success: true,
      sentTo: sent,
      date: dateFormatted,
      month: monthNameFormatted,
      combined,
      em: emTotals,
      ae,
      me,
      employees: reports,
      partners: partnerReports,
      ceoSent,
      ceoError,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
