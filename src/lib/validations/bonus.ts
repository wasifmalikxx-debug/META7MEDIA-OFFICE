import { z } from "zod";

/**
 * Schema for creating / upserting bonus eligibility criteria.
 */
export const bonusEligibilitySchema = z.object({
  userId: z.string().min(1),
  month: z.number().min(1).max(12),
  year: z.number().min(2024),

  dailyListingsComplete: z.boolean(),
  ordersProcessedSameDay: z.boolean(),
  messagesCleared: z.boolean(),
  zeroWrongOrders: z.boolean(),
  listingsRemovedCount: z.number().min(0),
  allStoresAbove4Stars: z.boolean(),
  totalProfit: z.number().min(0),

  notes: z.string().optional(),
});

/**
 * Schema for an employee submitting a review-bonus claim.
 */
export const reviewBonusSubmitSchema = z.object({
  storeName: z.string().min(1, "Store name is required"),
  customerName: z.string().optional(),
  originalRating: z.number().int().min(1).max(3),
  newRating: z.number().int().min(4).max(5),
  beforeScreenshot: z.string().min(1, "Before screenshot is required"),
  afterScreenshot: z.string().min(1, "After screenshot is required"),
});

/**
 * Schema for a manager / CEO approving or rejecting a review-bonus.
 */
export const reviewBonusActionSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().optional(),
});
