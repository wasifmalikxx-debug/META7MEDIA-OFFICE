import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { extractSheetId, normalizeTabName, getAlternativeTabNames } from "@/lib/services/google-sheets.service";
import { google } from "googleapis";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    // Read up to column N (14 cols). Some partner sheets use a wider layout
    // where PRICE is col 7, COST col 9, PROFIT col 10 — narrowing to A:J
    // would silently drop the profit column for those sheets and the report
    // would understate gross profit (only "Shape A" employees contribute).
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A1:N1`,
    });
    const headers = (headerRes.data.values?.[0] || []).map((h: string) => h.toLowerCase().trim());
    const dateCol = headers.findIndex((h: string) => h.includes("order date") || h.includes("date"));
    const priceCol = headers.findIndex((h: string) => h.includes("price"));
    const costCol = headers.findIndex((h: string) => h.includes("cost"));
    // Match the literal "profit" column, not "after tax profit". Headers
    // typically have both — picking the gross-profit column matches what
    // the analytics page displays.
    let profitCol = headers.findIndex((h: string) => h.trim() === "profit" || h.trim() === "gross profit");
    if (profitCol === -1) {
      profitCol = headers.findIndex((h: string) => h.includes("profit") && !h.includes("after tax"));
    }
    if (dateCol === -1) return empty;

    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${actualTab}'!A2:N1000`,
    });
    const rows = dataRes.data.values || [];

    let todayOrders = 0, todaySale = 0, todayCost = 0, todayProfit = 0;
    let monthOrders = 0, monthSale = 0, monthCost = 0, monthProfit = 0;

    for (const row of rows) {
      const dateVal = (row[dateCol] || "").toString().trim();
      if (!dateVal) continue;
      const rowSale = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
      const rowCost = costCol >= 0 ? parseDollar(row[costCol]) : 0;
      const rowProfit = profitCol >= 0 ? parseDollar(row[profitCol]) : 0;

      monthOrders++;
      monthSale += rowSale;
      monthCost += rowCost;
      monthProfit += rowProfit;

      if (isTodayCell(dateVal, todayPkt)) {
        todayOrders++;
        todaySale += rowSale;
        todayCost += rowCost;
        todayProfit += rowProfit;
      }
    }

    return {
      todayOrders, todaySale, todayCost, todayProfit,
      monthOrders, monthSale, monthCost, monthProfit,
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

    // Same fuzzy tab + date matching now applied to the EM loop. Drives
    // every member through readEmployeeSheetReport so a sheet renamed to
    // `MAY 2026` or with `2 May 2026` dates won't silently zero out.
    for (const empId of sortedIds) {
      const sheetId = SHEET_MAP[empId];
      const stats = await readEmployeeSheetReport(sheets, sheetId, reportMonth, reportYear, todayPkt);
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

    // Build the per-employee breakdown that goes into {{11}} of the Meta
    // daily_report template. Meta rejects template parameters that contain
    // \n, \t, or >4 consecutive spaces (error #132018), so we keep this on
    // a single line with inline separators. If no employee had orders, send
    // a dash so the parameter is never empty (Meta also rejects empty vars).
    // Show every team member in the breakdown (not just today's order-havers)
    // so the CEO sees who's idle as well as who's shipping. Same format as
    // the partner breakdown below for visual consistency.
    const breakdownParts: string[] = [];
    for (const r of reports) {
      breakdownParts.push(
        r.todayOrders > 0
          ? `${r.empId}: ${r.todayOrders} ($${r.todaySale.toFixed(2)})`
          : `${r.empId}: 0`
      );
    }
    const breakdown = breakdownParts.length > 0 ? breakdownParts.join(" | ") : "No team members";

    // Get CEO's phone numbers
    const ceo = await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN" },
      select: { phone: true, phone2: true },
    });

    const { sendDailyReportTemplate } = await import("@/lib/services/whatsapp.service");
    const sent: string[] = [];

    const payload = {
      date: dateFormatted,
      monthName: monthNameFormatted,
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
      breakdown,
    };

    if (ceo?.phone) {
      await sendDailyReportTemplate(ceo.phone, payload);
      sent.push(ceo.phone);
    }
    if (ceo?.phone2) {
      await sendDailyReportTemplate(ceo.phone2, payload);
      sent.push(ceo.phone2);
    }

    // ─── Partner reports (AE → Awais, ME → Mubeen) ─────────────────────
    // Each Etsy partner gets their own team's daily report on their WhatsApp.
    // Same daily_report Meta template — just with their team's numbers
    // instead of the CEO's company-wide EM aggregate. CEO's numbers above
    // remain whatever the SHEET_MAP yields and are unaffected by this block.
    const partnerReports: any[] = [];
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

        for (const member of teamMembers) {
          const sheetId = member.googleSheetUrl ? extractSheetId(member.googleSheetUrl) : null;
          if (!sheetId) {
            memberStats.push({ empId: member.employeeId, error: "invalid_sheet_url" });
            continue;
          }
          const stats = await readEmployeeSheetReport(sheets, sheetId, reportMonth, reportYear, todayPkt);
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

        const partnerPayload = {
          date: dateFormatted,
          monthName: monthNameFormatted,
          monthly: { orders: mOrders, sale: mSale, cost: mCost, profit: mProfit },
          today: { orders: tOrders, sale: tSale, cost: tCost, profit: tProfit },
          breakdown: breakdownParts.length > 0 ? breakdownParts.join(" | ") : "No team members",
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
          team: partner.partnerTeams[0]?.department?.name,
          sentTo: partnerSent,
          today: { orders: tOrders, sale: tSale, cost: tCost, profit: tProfit },
          monthly: { orders: mOrders, sale: mSale, cost: mCost, profit: mProfit },
          members: memberStats,
        });
      }
    } catch (partnerErr: any) {
      console.error("[daily-report] partner block failed:", partnerErr?.message);
      partnerReports.push({ error: partnerErr?.message });
    }

    return json({
      success: true,
      sentTo: sent,
      date: dateFormatted,
      month: monthNameFormatted,
      monthly: { orders: allOrdersMonth, sale: allSaleMonth, cost: allCostMonth, profit: allProfitMonth },
      today: { orders: allOrdersToday, sale: allSaleToday, cost: allCostToday, profit: allProfitToday },
      employees: reports,
      partners: partnerReports,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
