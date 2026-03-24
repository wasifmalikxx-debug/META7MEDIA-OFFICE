import { z } from "zod";

export const createEmployeeSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
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
  .partial();
