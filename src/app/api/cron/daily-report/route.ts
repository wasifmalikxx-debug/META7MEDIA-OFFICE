import { NextRequest } from "next/server";
import { json, error } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
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
  const now = new Date();
  const months = ["JAN", "FEB", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = months[now.getMonth()];
  const year = now.getFullYear().toString().slice(-2);
  return `${month} - 2K${year}`;
}

function getTodayDateStr(): string {
  const now = new Date();
  const day = now.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[now.getMonth()]}`;
}

interface EmployeeReport {
  empId: string;
  name: string;
  orders: number;
  totalSale: number;
  totalCost: number;
  profit: number;
}

export async function GET(request: NextRequest) {
  // Check if today is Sunday — skip
  const dayOfWeek = new Date().getDay();
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
    let allOrders = 0, allSale = 0, allCost = 0, allProfit = 0;

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
          reports.push({ empId, name: nameMap[empId] || empId, orders: 0, totalSale: 0, totalCost: 0, profit: 0 });
          continue;
        }

        // Read all data rows
        const dataRes = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${tabName}'!A2:J1000`,
        });
        const rows = dataRes.data.values || [];

        let empOrders = 0, empSale = 0, empCost = 0, empProfit = 0;

        for (const row of rows) {
          const dateVal = (row[dateCol] || "").toString().trim();
          if (dateVal.toLowerCase() === todayStr.toLowerCase()) {
            empOrders++;
            if (priceCol >= 0) empSale += parseDollar(row[priceCol]);
            if (costCol >= 0) empCost += parseDollar(row[costCol]);
            if (profitCol >= 0) empProfit += parseDollar(row[profitCol]);
          }
        }

        reports.push({
          empId,
          name: nameMap[empId] || empId,
          orders: empOrders,
          totalSale: empSale,
          totalCost: empCost,
          profit: empProfit,
        });

        allOrders += empOrders;
        allSale += empSale;
        allCost += empCost;
        allProfit += empProfit;
      } catch (sheetErr: any) {
        reports.push({ empId, name: nameMap[empId] || empId, orders: 0, totalSale: 0, totalCost: 0, profit: 0 });
      }
    }

    // Build the message
    const now = new Date();
    const dateFormatted = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

    let msg = `📊 *META7MEDIA — DAILY SALES REPORT*\n`;
    msg += `📅 Date: *${dateFormatted}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `🏢 *ALL OFFICE COMBINED*\n`;
    msg += `├ 📦 Total Orders: *${allOrders}*\n`;
    msg += `├ 💰 Total Sale: *$${allSale.toFixed(2)}*\n`;
    msg += `├ 📉 Total Cost: *$${allCost.toFixed(2)}*\n`;
    msg += `└ 📈 Profit Today: *$${allProfit.toFixed(2)}*\n\n`;

    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👥 *INDIVIDUAL BREAKDOWN*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const r of reports) {
      const emoji = r.profit > 0 ? "🟢" : r.profit < 0 ? "🔴" : "⚪";
      msg += `${emoji} *${r.empId} — ${r.name}*\n`;
      msg += `├ 📦 Orders: *${r.orders}*\n`;
      msg += `├ 💰 Sale: *$${r.totalSale.toFixed(2)}*\n`;
      msg += `├ 📉 Cost: *$${r.totalCost.toFixed(2)}*\n`;
      msg += `└ 📈 Profit: *$${r.profit.toFixed(2)}*\n\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🤖 _Automated by META7MEDIA AI_\n`;
    msg += `_Report generated at 8:01 PM PKT_`;

    // Get CEO's phone numbers
    const ceo = await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN" },
      select: { phone: true, phone2: true },
    });

    const { sendDailyReportTemplate } = await import("@/lib/services/whatsapp.service");
    const sent: string[] = [];

    // Build breakdown string for template
    let breakdown = "";
    for (const r of reports) {
      const emoji = r.profit > 0 ? "🟢" : r.profit < 0 ? "🔴" : "⚪";
      breakdown += `${emoji} ${r.empId} ${r.name}: ${r.orders} orders, $${r.profit.toFixed(2)}\n`;
    }

    if (ceo?.phone) {
      await sendDailyReportTemplate(ceo.phone, dateFormatted, String(allOrders), `$${allSale.toFixed(2)}`, `$${allProfit.toFixed(2)}`, breakdown.trim());
      sent.push(ceo.phone);
    }
    if (ceo?.phone2) {
      await sendDailyReportTemplate(ceo.phone2, dateFormatted, String(allOrders), `$${allSale.toFixed(2)}`, `$${allProfit.toFixed(2)}`, breakdown.trim());
      sent.push(ceo.phone2);
    }

    return json({
      success: true,
      sentTo: sent,
      date: dateFormatted,
      summary: { orders: allOrders, sale: allSale, cost: allCost, profit: allProfit },
      employees: reports,
    });
  } catch (err: any) {
    return error(err.message, 500);
  }
}
