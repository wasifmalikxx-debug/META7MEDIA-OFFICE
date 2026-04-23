import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Office settings — adjust all of these from the admin Settings page later.
  await prisma.officeSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      officeName: "Your Company",
      workStartTime: "09:00",
      workEndTime: "17:00",
      graceMinutes: 10,
      halfDayThresholdMin: 240,
      lateFineTier1Min: 10,
      lateFineTier1Amt: 0,
      lateFineTier2Min: 30,
      lateFineTier2Amt: 0,
      lateFineTier3Min: 60,
      lateFineTier3Amt: 0,
      autoAbsentAfterMin: 240,
      paidLeavesPerMonth: 1,
      ipRestrictionEnabled: false,
      workingDaysPerWeek: 5,
      weekendDays: "0,6",
    },
    update: {},
  });

  // One general department to start with. Add more from the Departments page.
  const general = await prisma.department.upsert({
    where: { name: "General" },
    create: { name: "General" },
    update: {},
  });

  const password = await bcrypt.hash("password123", 12);
  const year = new Date().getFullYear();

  // Admin / CEO account — change the password on first login.
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    create: {
      employeeId: "EMP-001",
      email: "admin@example.com",
      password,
      firstName: "Admin",
      lastName: "User",
      role: "SUPER_ADMIN",
      status: "HIRED",
      designation: "Owner / CEO",
      joiningDate: new Date(`${year}-01-01`),
      leaveBalances: { create: { year } },
      salaryStructure: {
        create: { monthlySalary: 100000, effectiveFrom: new Date(`${year}-01-01`) },
      },
    },
    update: {},
  });

  // A couple of demo employees so the UI has something to render.
  const employees = [
    { id: "EMP-002", email: "jane@example.com", first: "Jane", last: "Doe", salary: 50000, designation: "Team Lead" },
    { id: "EMP-003", email: "john@example.com", first: "John", last: "Doe", salary: 40000, designation: "Staff" },
    { id: "EMP-004", email: "alex@example.com", first: "Alex", last: "Smith", salary: 35000, designation: "Staff" },
  ];

  for (const emp of employees) {
    await prisma.user.upsert({
      where: { email: emp.email },
      create: {
        employeeId: emp.id,
        email: emp.email,
        password,
        firstName: emp.first,
        lastName: emp.last,
        role: "EMPLOYEE",
        status: "HIRED",
        designation: emp.designation,
        departmentId: general.id,
        managerId: admin.id,
        joiningDate: new Date(`${year}-01-15`),
        leaveBalances: { create: { year } },
        salaryStructure: {
          create: { monthlySalary: emp.salary, effectiveFrom: new Date(`${year}-01-15`) },
        },
      },
      update: {},
    });
  }

  await prisma.announcement.create({
    data: {
      title: "Welcome",
      content: "Welcome to the office manager. Check in daily and submit leave requests through this system.",
      priority: 1,
      authorId: admin.id,
    },
  });

  console.log("Seed completed!");
  console.log("");
  console.log("Login credentials (all users):");
  console.log("  Password: password123");
  console.log("");
  console.log("Accounts:");
  console.log("  Admin:    admin@example.com");
  console.log("  Employee: jane@example.com (and others)");
  console.log("");
  console.log("Change the admin password immediately after first login.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
