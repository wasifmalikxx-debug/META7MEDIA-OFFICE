import { z } from "zod";

export const checkInSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const manualAttendanceSchema = z.object({
  userId: z.string().min(1),
  date: z.string().min(1),
  status: z.enum(["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE"]),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  notes: z.string().optional(),
});
