/**
 * Deep audit of Sufyan (EM-3)'s Google Sheet for the current month.
 *
 * CEO flag (2026-06-09): "his profit is too much." His profit bonus was
 * built on a high AFTER-TAX figure. This script checks whether that
 * figure is legitimate or inflated by bad rows.
 *
 * Checks:
 *   - Column-by-column sums (sale / after-tax / cost / row-profit)
 *   - Summary cells (Y/Z box) vs row sums
 *   - DUPLICATE order IDs (same AE order entered twice = double count)
 *   - DUPLICATE (customer+price) combos
 *   - afterTax > price        (impossible — fees can't increase price)
 *   - cost <= 0 with sale > 0 (free product? data gap → inflates profit)
 *   - row profit != afterTax - cost (formula tampering)
 *   - price outliers (> 3× median — possible typo extra digit)
 *
 * Note: Google's per-cell EDIT history is NOT exposed through the
 * Sheets API (only file-level Drive revisions, which need a broader
 * scope than our read-only service account has). So this flags
 * anomalies in the CURRENT data, not who-typed-what-when.
 */

import { google } from "googleapis";
import path from "path";
import {
  extractSheetId,
  normalizeTabName,
  getAlternativeTabNames,
} from "../../src/lib/services/google-sheets.service";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const money = (v: any): number => {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
};

async function main() {
  const today = new Date(Date.now() + 5 * 60 * 60_000);
  const month = process.env.AUDIT_MONTH ? parseInt(process.env.AUDIT_MONTH) : today.getUTCMonth() + 1;
  const year = process.env.AUDIT_YEAR ? parseInt(process.env.AUDIT_YEAR) : today.getUTCFullYear();

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), "google-credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  const sufyan = await prisma.user.findFirst({
    where: { employeeId: "EM-3" },
    select: { firstName: true, lastName: true, googleSheetUrl: true },
  });
  if (!sufyan?.googleSheetUrl) { console.log("No sheet URL"); return; }
  const sheetId = extractSheetId(sufyan.googleSheetUrl);
  if (!sheetId) { console.log("Bad URL"); return; }

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabs = meta.data.sheets?.map((s) => s.properties?.title || "") || [];
  const candidateSet = new Set(getAlternativeTabNames(month, year).map(normalizeTabName));
  const tab = tabs.find((t) => candidateSet.has(normalizeTabName(t)));
  if (!tab) { console.log(`No tab for ${month}/${year}. Tabs: ${tabs.join(", ")}`); return; }

  console.log(`AUDIT — ${sufyan.firstName} ${sufyan.lastName} (EM-3) — tab '${tab}'`);
  console.log("═".repeat(118));

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: [`'${tab}'!A1:N1000`, `'${tab}'!V1:AE20`],
  });
  const rows = (batch.data.valueRanges?.[0]?.values || []) as any[][];
  const summaryRows = (batch.data.valueRanges?.[1]?.values || []) as any[][];

  // header detect
  let h = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = (rows[i] || []).map((c: any) => (c || "").toString().toLowerCase());
    if (r.some((c: string) => c.includes("order date") || c === "date")) { h = i; break; }
  }
  if (h < 0) { console.log("No header row"); return; }
  const H = (rows[h] || []).map((c: any) => (c || "").toString().toLowerCase().trim());
  const col = {
    store: H.findIndex((c) => c.includes("store") || c.includes("shop")),
    cust: H.findIndex((c) => c.includes("customer")),
    date: H.findIndex((c) => c.includes("order date") || c === "date"),
    aeOrder: H.findIndex((c) => c.includes("ae order") || c.includes("order id") || c.includes("order #") || c.includes("order number")),
    price: H.findIndex((c) => c.includes("price") || c.includes("sale")),
    afterTax: H.findIndex((c) => c.includes("after tax")),
    cost: H.findIndex((c) => c === "cost" || (c.includes("cost") && !c.includes("after"))),
    profit: H.findIndex((c) => c === "profit" || c.includes("profit")),
  };

  interface Row { i: number; store: string; cust: string; date: string; ae: string; price: number; afterTax: number; cost: number; profit: number; }
  const data: Row[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const price = money(r[col.price]);
    if (price <= 0) continue; // skip placeholder/blank rows
    data.push({
      i: i + 1,
      store: (r[col.store] || "").toString().trim(),
      cust: (r[col.cust] || "").toString().trim(),
      date: (r[col.date] || "").toString().trim(),
      ae: (r[col.aeOrder] || "").toString().trim(),
      price,
      afterTax: money(r[col.afterTax]),
      cost: money(r[col.cost]),
      profit: money(r[col.profit]),
    });
  }

  // sums
  const sum = (k: keyof Row) => data.reduce((s, r) => s + (r[k] as number), 0);
  const sumSale = sum("price"), sumAT = sum("afterTax"), sumCost = sum("cost"), sumProfit = sum("profit");
  console.log(`Rows with a price: ${data.length}`);
  console.log(`  Σ SALE      $${sumSale.toFixed(2)}`);
  console.log(`  Σ AFTER TAX $${sumAT.toFixed(2)}`);
  console.log(`  Σ COST      $${sumCost.toFixed(2)}`);
  console.log(`  Σ PROFIT col$${sumProfit.toFixed(2)}   (row profit column)`);
  console.log(`  GROSS (sale-cost) $${(sumSale - sumCost).toFixed(2)}`);

  // summary box
  console.log("\nSUMMARY BOX (what bonus + CEO read):");
  for (const r of summaryRows) {
    for (let c = 0; c < (r?.length || 0); c++) {
      const label = String(r[c] || "").trim().toUpperCase();
      if (["TOTAL SALE","TOTAL SALES","TOTAL COST","GROSS PROFIT","AFTER TAX"].includes(label)) {
        console.log(`  ${label.padEnd(14)} ${String(r[c+1] ?? "").trim()}`);
      }
    }
  }

  // ── ANOMALY FLAGS ──
  console.log("\n" + "═".repeat(118));
  console.log("FLAGS");
  console.log("─".repeat(118));
  let flags = 0;

  // duplicate AE order ids
  const byAe = new Map<string, Row[]>();
  for (const r of data) if (r.ae) { const a = byAe.get(r.ae) || []; a.push(r); byAe.set(r.ae, a); }
  for (const [ae, rs] of byAe) if (rs.length > 1) {
    flags++;
    console.log(`  ⚠ DUPLICATE AE ORDER "${ae}" on rows ${rs.map(r=>r.i).join(", ")} — $${rs.map(r=>r.price).join(" + $")} (possible double count)`);
  }

  // duplicate customer+price
  const byCp = new Map<string, Row[]>();
  for (const r of data) { const k = `${r.cust.toLowerCase()}|${r.price}`; const a = byCp.get(k) || []; a.push(r); byCp.set(k, a); }
  for (const [k, rs] of byCp) if (rs.length > 1 && rs[0].cust) {
    flags++;
    console.log(`  ⚠ SAME CUSTOMER+PRICE "${rs[0].cust}" $${rs[0].price} on rows ${rs.map(r=>r.i).join(", ")} (possible duplicate order)`);
  }

  // afterTax > price
  for (const r of data) if (r.afterTax > r.price + 0.01) {
    flags++;
    console.log(`  ⚠ row ${r.i}: AFTER TAX ($${r.afterTax}) > PRICE ($${r.price}) — impossible, fees can't raise price`);
  }

  // cost <= 0 with sale
  for (const r of data) if (r.cost <= 0 && r.price > 0) {
    flags++;
    console.log(`  ⚠ row ${r.i}: COST is $0 but SALE $${r.price} (${r.cust}) — missing cost inflates profit`);
  }

  // row profit != afterTax - cost (tolerance 1)
  for (const r of data) {
    const expected = r.afterTax - r.cost;
    if (Math.abs(expected - r.profit) > 1 && r.profit !== 0) {
      flags++;
      console.log(`  ⚠ row ${r.i}: PROFIT col $${r.profit} ≠ afterTax-cost ($${expected.toFixed(2)}) — formula off (${r.cust})`);
    }
  }

  // price outliers > 3× median
  const prices = data.map(r=>r.price).sort((a,b)=>a-b);
  const median = prices[Math.floor(prices.length/2)] || 0;
  for (const r of data) if (median > 0 && r.price > median * 3) {
    flags++;
    console.log(`  ⚠ row ${r.i}: PRICE $${r.price} is >3× median ($${median}) — ${r.cust} (typo / extra digit?)`);
  }

  if (flags === 0) console.log("  ✓ No anomalies detected — data looks clean.");
  else console.log(`\n  ${flags} flag(s) total.`);

  // top 5 highest-value orders for eyeballing
  console.log("\nTOP 5 HIGHEST-PRICE ORDERS:");
  [...data].sort((a,b)=>b.price-a.price).slice(0,5).forEach(r =>
    console.log(`  row ${r.i}: $${r.price} sale | $${r.afterTax} AT | $${r.cost} cost | ${r.cust} | ${r.date} | AE ${r.ae}`)
  );
}

main().catch(console.error).finally(() => prisma.$disconnect());
