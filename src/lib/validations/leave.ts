import { z } from "zod";

export const leaveRequestSchema = z.object({
  leaveType: z.enum(["CASUAL", "SICK", "UNPAID", "EMERGENCY", "HALF_DAY"]),
  halfDayPeriod: z.enum(["FIRST_HALF", "SECOND_HALF"]).optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  reason: z.string().min(1, "Reason is required"),
});

export const leaveActionSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().optional(),
});
