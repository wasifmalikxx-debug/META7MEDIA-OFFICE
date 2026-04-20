import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { nowPKT } from "@/lib/pkt";
import { google } from "googleapis";
import path from "path";
import fs from "fs";

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

function getMonthTabName(): string {
  // Use PKT time for correct month/year
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const months = ["JAN", "FEB", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = months[pkt.getUTCMonth()];
  const year = pkt.getUTCFullYear().toString().slice(-2);
  return `${month} - 2K${year}`;
}

function getTodayDateStr(): string {
  // Use PKT time for correct date
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const day = pkt.getUTCDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[pkt.getUTCMonth()]}`;
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
    const tabName = getMonthTabName();
    const todayStr = getTodayDateStr();

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

    for (const empId of sortedIds) {
      const sheetId = SHEET_MAP[empId];
      try {
        // Get headers to find column indices
        const headerRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${tabName}'!A1:J1`,
        });
        const headers = (headerRes.data.values?.[0] || []).map((h: string) => h.toLowerCase().trim());
        const dateCol = headers.findIndex((h: string) => h.includes("order date") || h.includes("date"));
        const priceCol = headers.findIndex((h: string) => h.includes("price"));
        const afterTaxCol = headers.findIndex((h: string) => h.includes("after tax"));
        const costCol = headers.findIndex((h: string) => h.includes("cost"));
        const profitCol = headers.findIndex((h: string) => h.includes("profit"));

        if (dateCol === -1) {
          reports.push({
            empId, name: nameMap[empId] || empId,
            todayOrders: 0, todaySale: 0, todayCost: 0, todayProfit: 0,
            monthOrders: 0, monthSale: 0, monthCost: 0, monthProfit: 0,
          });
          continue;
        }

        // Read all data rows
        const dataRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${tabName}'!A2:J1000`,
        });
        const rows = dataRes.data.values || [];

        let todayOrders = 0, todaySale = 0, todayCost = 0, todayProfit = 0;
        let monthOrders = 0, monthSale = 0, monthCost = 0, monthProfit = 0;

        for (const row of rows) {
          const dateVal = (row[dateCol] || "").toString().trim();
          if (!dateVal) continue; // skip empty rows

          const rowSale = priceCol >= 0 ? parseDollar(row[priceCol]) : 0;
          const rowCost = costCol >= 0 ? parseDollar(row[costCol]) : 0;
          const rowProfit = profitCol >= 0 ? parseDollar(row[profitCol]) : 0;

          // Every row in the current month tab counts toward month-to-date
          monthOrders++;
          monthSale += rowSale;
          monthCost += rowCost;
          monthProfit += rowProfit;

          // Rows matching today's date string also count toward today's totals
          if (dateVal.toLowerCase() === todayStr.toLowerCase()) {
            todayOrders++;
            todaySale += rowSale;
            todayCost += rowCost;
            todayProfit += rowProfit;
          }
        }

        reports.push({
          empId,
          name: nameMap[empId] || empId,
          todayOrders, todaySale, todayCost, todayProfit,
          monthOrders, monthSale, monthCost, monthProfit,
        });

        allOrdersToday += todayOrders;
        allSaleToday += todaySale;
        allCostToday += todayCost;
        allProfitToday += todayProfit;
        allOrdersMonth += monthOrders;
        allSaleMonth += monthSale;
        allCostMonth += monthCost;
        allProfitMonth += monthProfit;
      } catch (sheetErr: any) {
        reports.push({
          empId, name: nameMap[empId] || empId,
          todayOrders: 0, todaySale: 0, todayCost: 0, todayProfit: 0,
          monthOrders: 0, monthSale: 0, monthCost: 0, monthProfit: 0,
        });
      }
    }

    // Build the message
    const now = nowPKT();
    const dateFormatted = `${now.getUTCDate()}/${now.getUTCMonth() + 1}/${now.getUTCFullYear()}`;
    const monthNamesFull = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const monthNameFormatted = `${monthNamesFull[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

    // ── Build breakdown strings — two shapes for two provider templates ──
    // breakdownMultiline: emoji + newlines per employee (new Meta template {{11}})
    // breakdownFlat:      pipe-separated single line (legacy Twilio template {{5}})
    // Both include only employees with orders today.
    const multilineParts: string[] = [];
    const flatParts: string[] = [];
    for (const r of reports) {
      if (r.todayOrders > 0) {
        multilineParts.push(
          `📌 *${r.empId}*\n📦 Total Orders: ${r.todayOrders}\n💰 Total Sale: $${r.todaySale.toFixed(2)}`
        );
        const emoji = r.todayProfit > 0 ? "🟢" : r.todayProfit < 0 ? "🔴" : "⚪";
        flatParts.push(`${emoji} ${r.empId} ${r.name}: ${r.todayOrders} orders $${r.todayProfit.toFixed(2)}`);
      }
    }
    const breakdownMultiline = multilineParts.join("\n\n");
    const breakdownFlat = flatParts.join(" | ");

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
      breakdownMultiline,
      breakdownFlat,
    };

    if (ceo?.phone) {
      await sendDailyReportTemplate(ceo.phone, payload);
      sent.push(ceo.phone);
    }
    if (ceo?.phone2) {
      await sendDailyReportTemplate(ceo.phone2, payload);
      sent.push(ceo.phone2);
    }

    return json({
      success: true,
      sentTo: sent,
      date: dateFormatted,
      month: monthNameFormatted,
      monthly: { orders: allOrdersMonth, sale: allSaleMonth, cost: allCostMonth, profit: allProfitMonth },
      today: { orders: allOrdersToday, sale: allSaleToday, cost: allCostToday, profit: allProfitToday },
      employees: reports,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
