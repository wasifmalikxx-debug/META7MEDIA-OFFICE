/**
 * Verifies the local Etsy price calculator against the 18 sample rows
 * Wasif shared from the live Google Sheets pricing table. Every output
 * must match to the cent — anything off is a parser/transcription bug.
 *
 * Run:  npx tsx prisma/scripts/verify-price-calculator.ts
 */

import { calculateEtsyPrice } from "../../src/lib/etsy-price-calculator";

const samples: { ali: number; expected: number }[] = [
  { ali: 12.99, expected: 72.91764706 },
  { ali: 15.99, expected: 84.68235294 },
  { ali: 16.32, expected: 85.45882353 },
  { ali: 29.02, expected: 134.1647059 },
  { ali: 10.43, expected: 66.89411765 },
  { ali: 20.21, expected: 101.6705882 },
  { ali: 16, expected: 84.70588235 },
  { ali: 5.43, expected: 52.77647059 },
  { ali: 8.92, expected: 60.98823529 },
  { ali: 7.63, expected: 57.95294118 },
  { ali: 9.72, expected: 62.87058824 },
  { ali: 13.35, expected: 73.76470588 },
  { ali: 10.64, expected: 67.38823529 },
  { ali: 19.56, expected: 93.08235294 },
  { ali: 14.5, expected: 76.47058824 },
  { ali: 10.25, expected: 66.47058824 },
  { ali: 7.07, expected: 56.63529412 },
  { ali: 20.46, expected: 102.2588235 },
  // ─── New regime — ali > $150 — proportional markup (ali × 2/3) ───
  // subtotal = ali + (ali × 2/3) = ali × 5/3, then divided by 0.425.
  //   ali=151  → markup≈100.67 → subtotal≈251.67 → ≈592.16
  //   ali=200  → markup≈133.33 → subtotal≈333.33 → ≈784.31
  //   ali=300  → markup=200    → subtotal=500    → ≈1176.47
  //   ali=500  → markup≈333.33 → subtotal≈833.33 → ≈1960.78
  { ali: 151, expected: 592.156862745 },
  { ali: 200, expected: 784.313725490 },
  { ali: 300, expected: 1176.470588235 },
  { ali: 500, expected: 1960.784313725 },
];

console.log("\nEtsy price calculator verification\n");
console.log(
  "  Ali       Expected         Computed         Diff      Tier",
);
console.log(
  "  ──────    ──────────────   ──────────────   ───────   ────────────",
);

let mismatches = 0;
for (const s of samples) {
  const r = calculateEtsyPrice(s.ali);
  // Sheet displays 8 decimals; allow $0.005 of float tolerance.
  const diff = Math.abs(r.etsyMatured - s.expected);
  const ok = diff < 0.005;
  if (!ok) mismatches++;
  const tierLabel = r.tier
    ? `≤$${r.tier.maxAli} → +$${r.tier.markup}`
    : "(out of table)";
  console.log(
    `  ${ok ? "✓" : "✗"} $${s.ali.toFixed(2).padStart(6)}  ` +
      `$${s.expected.toFixed(8).padStart(13)}   ` +
      `$${r.etsyMatured.toFixed(8).padStart(13)}   ` +
      `${diff < 1e-6 ? "exact " : `${diff.toFixed(6)}`}   ${tierLabel}`,
  );
}

console.log();
if (mismatches === 0) {
  console.log(
    `✓ All ${samples.length} samples match. Calculator is live.`,
  );
} else {
  console.log(`✗ ${mismatches} of ${samples.length} mismatched.`);
  process.exit(1);
}
console.log();
