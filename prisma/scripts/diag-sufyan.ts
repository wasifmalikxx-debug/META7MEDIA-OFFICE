import { PrismaClient } from "@prisma/client";
import {
  fetchSheetAnalytics,
  fetchProfitFromSheet,
} from "../../src/lib/services/google-sheets.service";

const prisma = new PrismaClient();

async function main() {
  const pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = pkt.getUTCMonth() + 1;
  const year = pkt.getUTCFullYear();

  console.log(`DIAGNOSTIC — ${month}/${year} (PKT)\n`);

  const sufyan = await prisma.user.findFirst({
    where: {
      OR: [
        { firstName: { contains: "Sufyan", mode: "insensitive" } },
        { lastName: { contains: "Sufyan", mode: "insensitive" } },
        { email: { contains: "sufyan", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      email: true,
      googleSheetUrl: true,
      status: true,
      department: { select: { name: true } },
    },
  });

  if (!sufyan) {
    console.log("Sufyan NOT FOUND in DB");
    return;
  }

  console.log("SUFYAN ROW:");
  console.log(JSON.stringify(sufyan, null, 2));
  console.log("");

  // Current bonus eligibility
  const elig = await prisma.bonusEligibility.findFirst({
    where: { userId: sufyan.id, month, year },
  });
  console.log("CURRENT bonusEligibility row:");
  console.log(JSON.stringify(elig, null, 2));
  console.log("");

  // Current incentives this month
  const inc = await prisma.incentive.findMany({
    where: { userId: sufyan.id, month, year },
    select: { id: true, type: true, amount: true, reason: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log("CURRENT incentives:");
  console.log(JSON.stringify(inc, null, 2));
  console.log("");

  if (!sufyan.googleSheetUrl) {
    console.log("No sheet URL on file — can't compute fresh profit.");
    return;
  }

  // Fresh from sheet
  const data = await fetchSheetAnalytics(sufyan.googleSheetUrl, month, year);
  if (data.error) {
    console.log("Sheet fetch ERROR:", data.error);
    return;
  }
  let sale = 0, cost = 0, afterTax = 0;
  for (const o of data.orders) {
    sale += o.price;
    cost += o.cost;
    afterTax += o.afterTax;
  }
  const gross = sale - cost;
  console.log("FRESH SHEET READ:");
  console.log(`  Orders:    ${data.orders.length}`);
  console.log(`  Σ Sale:    $${sale.toFixed(2)}`);
  console.log(`  Σ Cost:    $${cost.toFixed(2)}`);
  console.log(`  Σ AfterTax:$${afterTax.toFixed(2)}    <-- bonus input`);
  console.log(`  Gross:     $${gross.toFixed(2)}      <-- analytics/WhatsApp`);
  console.log("");

  // What fetchProfitFromSheet returns NOW
  const bonusInput = await fetchProfitFromSheet(sufyan.googleSheetUrl, month, year);
  console.log("fetchProfitFromSheet returns:");
  console.log(`  profit: $${bonusInput.profit}`);
  console.log(`  error:  ${bonusInput.error}`);
  console.log("");

  // Compute the bonus
  const profitForBonus = bonusInput.profit ?? 0;
  const tiers = profitForBonus >= 1000 ? Math.floor(profitForBonus / 500) : 0;
  const bonusPKR = tiers * 5000;
  console.log("EXPECTED bonus (per current rule):");
  console.log(`  Tiers:    ${tiers}`);
  console.log(`  Bonus:    PKR ${bonusPKR.toLocaleString()}`);
  console.log("");

  // What is the stored bonus saying?
  const profitBonusInc = inc.find(i => i.reason.startsWith("Profit Bonus"));
  if (profitBonusInc) {
    console.log("STORED Profit Bonus incentive:");
    console.log(`  Amount:   PKR ${profitBonusInc.amount.toLocaleString()}`);
    console.log(`  Reason:   ${profitBonusInc.reason}`);

    if (profitBonusInc.amount !== bonusPKR) {
      console.log("");
      console.log(`✗ MISMATCH: stored ${profitBonusInc.amount} ≠ expected ${bonusPKR}`);
      console.log("  → run sync-profits cron to refresh");
    } else {
      console.log("✓ stored amount matches expected");
    }
  } else {
    console.log("No Profit Bonus incentive currently stored.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
