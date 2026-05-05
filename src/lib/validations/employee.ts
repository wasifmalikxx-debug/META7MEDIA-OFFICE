import { z } from "zod";

export const createEmployeeSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  // Last name is OPTIONAL — Pakistani / South-Asian mononyms (e.g. ME-3
  // "Nabeel") are common. Allow empty string so the Edit Employee form
  // can save name-less entries without the form rejecting them. The DB
  // column is `text NOT NULL` so we still default to empty string on the
  // server side rather than null.
  lastName: z.string().optional().default(""),
  phone: z.string().optional(),
  role: z.enum(["SUPER_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"]),
  designation: z.string().optional(),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
  managerId: z.string().optional(),
  joiningDate: z.string().min(1, "Joining date is required"),
  monthlySalary: z.number().min(0, "Salary must be positive"),
});

export const updateEmployeeSchema = createEmployeeSchema
  .omit({ password: true, employeeId: true })
  .partial()
  .extend({
    newPassword: z.string().min(6).optional().or(z.literal("")),
  });
