/**
 * Etsy price calculator — Ali Express cost → Etsy listing price.
 *
 * Mirrors the Google Sheets formula the Etsy team uses today:
 *
 *   = (C2 +
 *     IF(C2<=5, 15,
 *     IF(C2<=10, 17,
 *     IF(C2<=15, 18,
 *     ...
 *     IF(C2<=150, 100, 0)
 *     ))))...) / 0.425
 *
 * Two parts:
 *
 *   1. Stepped markup — adds a flat dollar amount based on the Ali Express
 *      cost bracket. The number covers shipping cost (which scales roughly
 *      with item size), Etsy listing/transaction fees, payment processing,
 *      and a small profit pad. Larger items cost more to ship, hence the
 *      bigger markup at higher brackets.
 *
 *   2. Divide by 0.425 — the "net rate". 1 − 0.425 = 0.575 covers Etsy
 *      transaction fee + payment processing + tax + target margin. The
 *      result is the gross listing price that nets the seller their cost
 *      back after fees.
 *
 * Boundary semantics: every `IF(C2 <= X)` uses ≤, so a price exactly equal
 * to a threshold lands in the LOWER bracket. e.g. ali=15.00 → markup +18,
 * ali=15.01 → markup +20.
 *
 * Out-of-range fallback: prices above $150 fall through the IF cascade to
 * the trailing `0` — markup becomes 0 and the formula returns ali / 0.425.
 * The UI surfaces a warning in this case so the user knows the table
 * doesn't cover their item.
 *
 * Source: confirmed live against 18 sample rows from the Etsy pricing
 * sheet on 2026-05-13. Every sample matched to the cent.
 */

export interface MarkupTier {
  /** Inclusive upper bound for this bracket. `aliPrice <= maxAli` selects this tier. */
  maxAli: number;
  /** Dollar amount added to the Ali Express cost. */
  markup: number;
}

export const MARKUP_TIERS: ReadonlyArray<MarkupTier> = [
  { maxAli: 5, markup: 15 },
  { maxAli: 10, markup: 17 },
  { maxAli: 15, markup: 18 },
  { maxAli: 20, markup: 20 },
  { maxAli: 25, markup: 23 },
  { maxAli: 30, markup: 28 },
  { maxAli: 35, markup: 33 },
  { maxAli: 40, markup: 35 },
  { maxAli: 45, markup: 40 },
  { maxAli: 50, markup: 46 },
  { maxAli: 55, markup: 50 },
  { maxAli: 60, markup: 55 },
  { maxAli: 65, markup: 55 },
  { maxAli: 70, markup: 60 },
  { maxAli: 75, markup: 60 },
  { maxAli: 80, markup: 63 },
  { maxAli: 85, markup: 65 },
  { maxAli: 90, markup: 65 },
  { maxAli: 95, markup: 65 },
  { maxAli: 100, markup: 70 },
  { maxAli: 105, markup: 75 },
  { maxAli: 110, markup: 75 },
  { maxAli: 115, markup: 75 },
  { maxAli: 120, markup: 80 },
  { maxAli: 125, markup: 80 },
  { maxAli: 130, markup: 90 },
  { maxAli: 135, markup: 90 },
  { maxAli: 140, markup: 95 },
  { maxAli: 145, markup: 95 },
  { maxAli: 150, markup: 100 },
];

/** 1 − 0.575 (Etsy fees + payment processing + target margin). */
export const NET_DIVISOR = 0.425;

/**
 * New shops discount the matured-formula output by this fraction. The
 * lower listing price gets traction (Etsy SEO rewards shops with sales),
 * which is more valuable than the lost margin while the shop is building
 * credibility.
 */
export const NEW_SHOP_DISCOUNT = 0.10;

/** Highest Ali Express price the markup table covers. */
export const MAX_TABLE_ALI = MARKUP_TIERS[MARKUP_TIERS.length - 1].maxAli;

/**
 * Markup-to-ali ratio used when ali > MAX_TABLE_ALI ($150).
 *
 * Picked by extrapolating the existing table: the markup-as-fraction-of-ali
 * starts at 300% (small items need huge % to cover Etsy fixed fees) and
 * monotonically decreases as cost rises, asymptoting around 2/3:
 *
 *   ali=$50  → markup=$46  → 92%
 *   ali=$100 → markup=$70  → 70%
 *   ali=$150 → markup=$100 → 66.7%  ← table ends here
 *
 * Continuing at 2/3 keeps the post-fee profit margin on cost at a stable
 * ~66% for any high-priced item, with no boundary jump at $150
 * (ali=$150 gives the same $100 markup via either branch).
 *
 * Earlier behavior was markup=0 above $150 (the sheet's IF cascade returns
 * 0 as the fallback) — which silently produced zero-margin listings. This
 * fixes that.
 */
export const ABOVE_TABLE_MARKUP_RATIO = 2 / 3;

/** Which pricing mode the caller is in. Drives which final number renders. */
export type PriceMode = "matured" | "new";

export interface PriceCalculation {
  aliPrice: number;
  markup: number;
  /** ali + markup, before the net-rate divide. */
  subtotal: number;
  /** Matured-shop price = subtotal / 0.425. The base output. */
  etsyMatured: number;
  /** New-shop price = etsyMatured × (1 − NEW_SHOP_DISCOUNT). */
  etsyNew: number;
  /** Bracket that was applied; null when ali > MAX_TABLE_ALI (out of range). */
  tier: MarkupTier | null;
  /** Inclusive lower bound of the matched bracket (for display). */
  tierMinAli: number;
}

/**
 * Maximum absolute personalization offset applied per user (USD).
 *
 * Reason: when two different sellers price the SAME AliExpress item,
 * the discrete formula gives them an identical Etsy listing price.
 * That tipped off Etsy's anti-dupe heuristics and made our shops
 * look like a single organisation. To break the tie, the calculator
 * accepts a `userSeed` and adds a deterministic per-user offset in
 * the range [-PERSONALIZATION_OFFSET_MAX, +PERSONALIZATION_OFFSET_MAX]
 * to the final price. Same user + same ali cost → same offset (stable
 * across page reloads). Different users → different offsets.
 *
 * CEO ask (May 16 2026): "1-2$ margin is good to go" — i.e. ±$2 max
 * swing is acceptable for both matured and new-shop modes.
 */
export const PERSONALIZATION_OFFSET_MAX = 2;

/**
 * Deterministic hash → pseudo-random number in [-1, +1].
 * Same input always returns same output (so the user sees stable
 * prices on reload), but different inputs map to different positions
 * in the range. Simple djb2-ish hash, no crypto needed.
 */
function deterministicSwing(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  // Normalize abs hash to [0, 1) then map to [-1, +1)
  const norm = (Math.abs(h) % 100000) / 100000;
  return norm * 2 - 1;
}

/**
 * Run the stepped-markup formula on a single Ali Express cost.
 *
 * Two regimes:
 *
 *   • ali ≤ $150  → use the team's discrete markup table (verified live
 *                   against 18 sample rows from the pricing sheet).
 *
 *   • ali > $150  → continue with proportional markup at 2/3 of ali.
 *                   This isn't in the team's sheet — the sheet drops to
 *                   0 markup above $150 — but that produces zero-margin
 *                   listings, so we extrapolate the table's converging
 *                   trend instead. See ABOVE_TABLE_MARKUP_RATIO for the
 *                   derivation.
 *
 * Optional `userSeed` adds a deterministic ±$2 personalization offset
 * (see PERSONALIZATION_OFFSET_MAX) so two sellers pricing the same
 * product don't get an identical Etsy price — fights the Etsy
 * anti-dupe heuristics across our shops.
 *
 * Always returns BOTH prices (matured and new-shop). `tier` is null when
 * ali is above the discrete table (i.e. we're in the proportional regime).
 */
export function calculateEtsyPrice(
  aliPrice: number,
  options?: { userSeed?: string },
): PriceCalculation {
  let matchedIdx = -1;
  for (let i = 0; i < MARKUP_TIERS.length; i++) {
    if (aliPrice <= MARKUP_TIERS[i].maxAli) {
      matchedIdx = i;
      break;
    }
  }

  let markup: number;
  let tier: MarkupTier | null;
  let tierMinAli: number;

  if (matchedIdx >= 0) {
    tier = MARKUP_TIERS[matchedIdx];
    tierMinAli = matchedIdx > 0 ? MARKUP_TIERS[matchedIdx - 1].maxAli : 0;
    markup = tier.markup;
  } else {
    // Proportional regime — continues the table's trend.
    tier = null;
    tierMinAli = MAX_TABLE_ALI;
    markup = aliPrice * ABOVE_TABLE_MARKUP_RATIO;
  }

  const subtotal = aliPrice + markup;
  let etsyMatured = subtotal / NET_DIVISOR;
  let etsyNew = etsyMatured * (1 - NEW_SHOP_DISCOUNT);

  // Per-user personalization offset — applied AFTER the divide so
  // the absolute swing stays bounded at ±PERSONALIZATION_OFFSET_MAX
  // (would be ~2.4× larger if applied before the divide). Same
  // offset is added to both modes so the ABSOLUTE matured/new gap
  // is preserved (the percentage discount shifts by <1% in practice,
  // unnoticeable to sellers).
  if (options?.userSeed) {
    const offset =
      deterministicSwing(`${options.userSeed}|${aliPrice}`) *
      PERSONALIZATION_OFFSET_MAX;
    etsyMatured += offset;
    etsyNew += offset;
  }

  return {
    aliPrice,
    markup,
    subtotal,
    etsyMatured,
    etsyNew,
    tier,
    tierMinAli,
  };
}
