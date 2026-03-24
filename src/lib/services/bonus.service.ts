/**
 * Bonus Calculation Service — E-Commerce Bonus Program 2.0
 *
 * Rules:
 *  - All 7 boolean criteria must be true
 *  - listingsRemovedCount must be <= 3
 *  - totalProfit must be >= $1000
 *  - Profit tiers:
 *      < $1000  => no bonus
 *      $1000-$1499 => bonusAmount capped at $1000
 *      $1500+  => bonusAmount = full profit (CEO will manually set final %)
 */

export interface BonusCriteria {
  dailyListingsComplete: boolean;
  ordersProcessedSameDay: boolean;
  messagesCleared: boolean;
  zeroWrongOrders: boolean;
  listingsRemovedCount: number;
  allStoresAbove4Stars: boolean;
  totalProfit: number; // USD
}

export interface BonusResult {
  isEligible: boolean;
  bonusAmount: number; // stored profit-based amount; CEO sets final bonus
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

  // Profit must be at least $1000
  const profitOk = totalProfit >= 1000;

  const isEligible = allCriteriaMet && listingsOk && profitOk;

  if (!isEligible) {
    return { isEligible: false, bonusAmount: 0 };
  }

  // Profit tiers
  let bonusAmount: number;
  if (totalProfit < 1000) {
    bonusAmount = 0;
  } else if (totalProfit < 1500) {
    bonusAmount = Math.min(totalProfit, 1000);
  } else {
    bonusAmount = totalProfit; // full profit passed through; CEO sets actual bonus
  }

  return { isEligible, bonusAmount };
}
