/**
 * Bonus Calculation Service — E-Commerce Bonus Program 2.0
 *
 * Formula:
 *  - All 7 criteria must be met
 *  - listingsRemovedCount must be <= 3
 *  - Combined monthly profit of all stores must reach at least $1,000
 *
 * Bonus tiers (PKR):
 *   < $1,000   => PKR 0 (not eligible)
 *   $1,000     => PKR 10,000
 *   $1,001-$1,499 => PKR 10,000 (capped at $1,000 tier)
 *   $1,500     => PKR 15,000
 *   $2,000     => PKR 20,000
 *   $5,000     => PKR 50,000
 *
 * Core formula: floor(profit / 500) * 5,000 PKR
 * Rate: 10 PKR per $1 USD (rounded down to nearest $500 tier)
 */

export interface BonusCriteria {
  dailyListingsComplete: boolean;
  ordersProcessedSameDay: boolean;
  messagesCleared: boolean;
  zeroWrongOrders: boolean;
  listingsRemovedCount: number;
  allStoresAbove4Stars: boolean;
  totalProfit: number; // USD — combined monthly profit of all stores
}

export interface BonusResult {
  isEligible: boolean;
  bonusAmountPKR: number;   // Final bonus in PKR
  profitTierUSD: number;     // Which $500 tier they hit
  profitUSD: number;         // Raw profit entered
}

export function calculateEligibility(criteria: BonusCriteria): BonusResult {
  const {
    dailyListingsComplete,
    ordersProcessedSameDay,
    messagesCleared,
    zeroWrongOrders,
    listingsRemovedCount,
    allStoresAbove4Stars,
    totalProfit,
  } = criteria;

  // All boolean criteria must be true
  const allCriteriaMet =
    dailyListingsComplete &&
    ordersProcessedSameDay &&
    messagesCleared &&
    zeroWrongOrders &&
    allStoresAbove4Stars;

  // Listings removed must be <= 3
  const listingsOk = listingsRemovedCount <= 3;

  // Profit must be at least $1,000
  const profitOk = totalProfit >= 1000;

  const isEligible = allCriteriaMet && listingsOk && profitOk;

  if (!isEligible) {
    return {
      isEligible: false,
      bonusAmountPKR: 0,
      profitTierUSD: 0,
      profitUSD: totalProfit,
    };
  }

  // Floor to nearest $500 tier, then multiply by 5,000 PKR
  // $1,000 = 2 tiers × 5,000 = 10,000 PKR
  // $1,499 = 2 tiers × 5,000 = 10,000 PKR (capped at $1,000 tier)
  // $1,500 = 3 tiers × 5,000 = 15,000 PKR
  // $2,000 = 4 tiers × 5,000 = 20,000 PKR
  // $5,000 = 10 tiers × 5,000 = 50,000 PKR
  const tiers = Math.floor(totalProfit / 500);
  const bonusAmountPKR = tiers * 5000;
  const profitTierUSD = tiers * 500;

  return {
    isEligible,
    bonusAmountPKR,
    profitTierUSD,
    profitUSD: totalProfit,
  };
}

/**
 * Helper: Format bonus tier display
 */
export function formatBonusTier(profitUSD: number): string {
  if (profitUSD < 1000) return "Not Eligible";
  const tiers = Math.floor(profitUSD / 500);
  const tierUSD = tiers * 500;
  const bonusPKR = tiers * 5000;
  return `$${tierUSD.toLocaleString()} tier → PKR ${bonusPKR.toLocaleString()}`;
}

/**
 * Helper: Get bonus breakdown for display
 */
export function getBonusBreakdown(profitUSD: number): {
  tier: string;
  bonusPKR: number;
  nextTierAt: number | null;
  nextTierBonus: number | null;
} {
  if (profitUSD < 1000) {
    return {
      tier: "Below minimum ($1,000)",
      bonusPKR: 0,
      nextTierAt: 1000,
      nextTierBonus: 10000,
    };
  }

  const tiers = Math.floor(profitUSD / 500);
  const tierUSD = tiers * 500;
  const bonusPKR = tiers * 5000;
  const nextTierAt = (tiers + 1) * 500;
  const nextTierBonus = (tiers + 1) * 5000;

  return {
    tier: `$${tierUSD.toLocaleString()}`,
    bonusPKR,
    nextTierAt,
    nextTierBonus,
  };
}
