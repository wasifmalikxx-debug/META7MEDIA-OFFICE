import { z } from "zod";

export const salaryStructureSchema = z.object({
  userId: z.string().min(1),
  monthlySalary: z.number().min(0),
  currency: z.string().default("PKR"),
  taxPercent: z.number().min(0).max(100).default(0),
  socialSecurity: z.number().min(0).default(0),
  otherDeductions: z.number().min(0).default(0),
  deductionNotes: z.string().optional(),
  effectiveFrom: z.string().min(1),
});

export const generatePayrollSchema = z.object({
  month: z.number().min(1).max(12),
  year: z.number().min(2024),
});

export const incentiveSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(["FIXED", "PERCENTAGE", "TARGET_BASED", "MANUAL"]),
  amount: z.number().min(0),
  percentage: z.number().optional(),
  reason: z.string().min(1),
  month: z.number().min(1).max(12),
  year: z.number().min(2024),
});

export const fineSchema = z.object({
  userId: z.string().min(1),
  type: z.enum([
    "LATE_ARRIVAL",
    "EARLY_DEPARTURE",
    "ABSENT_WITHOUT_LEAVE",
    "POLICY_VIOLATION",
    "OTHER",
  ]),
  amount: z.number().min(0),
  reason: z.string().min(1),
  date: z.string().min(1),
});
