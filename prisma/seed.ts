import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Multi-office: ensure the primary office (OFFICE 1) exists first.
  const office1 = await prisma.office.upsert({
    where: { slug: "office-1" },
    create: { slug: "office-1", name: "META7MEDIA HQ", isPrimary: true },
    update: {},
  });

  // Create office settings (one per office)
  await prisma.officeSettings.upsert({
    where: { officeId: office1.id },
    create: {
      id: "default",
      officeId: office1.id,
      officeName: "META7MEDIA",
      workStartTime: "11:00",
      workEndTime: "19:00",
      graceMinutes: 10,
      halfDayThresholdMin: 240,
      lateFineTier1Min: 10,
      lateFineTier1Amt: 100,
      lateFineTier2Min: 30,
      lateFineTier2Amt: 300,
      lateFineTier3Min: 60,
      lateFineTier3Amt: 500,
      autoAbsentAfterMin: 240,
      paidLeavesPerMonth: 1,
      ipRestrictionEnabled: false,
      workingDaysPerWeek: 6,
      weekendDays: "0",
    },
    update: {},
  });

  // Create departments (scoped to OFFICE 1)
  const devDept = await prisma.department.upsert({
    where: { name_officeId: { name: "Development", officeId: office1.id } },
    create: { name: "Development", officeId: office1.id },
    update: {},
  });

  const designDept = await prisma.department.upsert({
    where: { name_officeId: { name: "Design", officeId: office1.id } },
    create: { name: "Design", officeId: office1.id },
    update: {},
  });

  const marketingDept = await prisma.department.upsert({
    where: { name_officeId: { name: "Marketing", officeId: office1.id } },
    create: { name: "Marketing", officeId: office1.id },
    update: {},
  });

  const password = await bcrypt.hash("password123", 12);
  const year = new Date().getFullYear();

  // Create Super Admin (Owner)
  const admin = await prisma.user.upsert({
    where: { email: "admin@meta7media.com" },
    create: {
      employeeId: "M7M-001",
      email: "admin@meta7media.com",
      password,
      firstName: "Wasif",
      lastName: "Malik",
      role: "SUPER_ADMIN",
      status: "HIRED",
      designation: "Owner / CEO",
      joiningDate: new Date("2023-01-01"),
      officeId: office1.id,
      leaveBalances: { create: { year } },
      salaryStructure: {
        create: { monthlySalary: 200000, effectiveFrom: new Date("2023-01-01") },
      },
    },
    update: {},
  });

  // Create HR Admin
  const hr = await prisma.user.upsert({
    where: { email: "hr@meta7media.com" },
    create: {
      employeeId: "M7M-002",
      email: "hr@meta7media.com",
      password,
      firstName: "Sara",
      lastName: "Ahmed",
      role: "HR_ADMIN",
      status: "HIRED",
      designation: "HR Manager",
      departmentId: devDept.id,
      officeId: office1.id,
      joiningDate: new Date("2023-03-15"),
      leaveBalances: { create: { year } },
      salaryStructure: {
        create: { monthlySalary: 80000, effectiveFrom: new Date("2023-03-15") },
      },
    },
    update: {},
  });

  // Create Manager
  const manager = await prisma.user.upsert({
    where: { email: "manager@meta7media.com" },
    create: {
      employeeId: "M7M-003",
      email: "manager@meta7media.com",
      password,
      firstName: "Ali",
      lastName: "Khan",
      role: "MANAGER",
      status: "HIRED",
      designation: "Project Manager",
      departmentId: devDept.id,
      officeId: office1.id,
      joiningDate: new Date("2023-06-01"),
      leaveBalances: { create: { year } },
      salaryStructure: {
        create: { monthlySalary: 100000, effectiveFrom: new Date("2023-06-01") },
      },
    },
    update: {},
  });

  // Create Employees
  const employeeData = [
    { id: "M7M-004", email: "usman@meta7media.com", first: "Usman", last: "Raza", dept: devDept.id, salary: 60000, designation: "Frontend Developer" },
    { id: "M7M-005", email: "ayesha@meta7media.com", first: "Ayesha", last: "Noor", dept: devDept.id, salary: 55000, designation: "Backend Developer" },
    { id: "M7M-006", email: "bilal@meta7media.com", first: "Bilal", last: "Hussain", dept: designDept.id, salary: 50000, designation: "UI/UX Designer" },
    { id: "M7M-007", email: "fatima@meta7media.com", first: "Fatima", last: "Zahra", dept: marketingDept.id, salary: 45000, designation: "Marketing Executive" },
    { id: "M7M-008", email: "hamza@meta7media.com", first: "Hamza", last: "Tariq", dept: devDept.id, salary: 70000, designation: "Senior Developer" },
    { id: "M7M-009", email: "zainab@meta7media.com", first: "Zainab", last: "Ali", dept: designDept.id, salary: 40000, designation: "Graphic Designer" },
    { id: "M7M-010", email: "omar@meta7media.com", first: "Omar", last: "Farooq", dept: marketingDept.id, salary: 35000, designation: "Social Media Manager" },
  ];

  for (const emp of employeeData) {
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
        departmentId: emp.dept,
        managerId: manager.id,
        officeId: office1.id,
        joiningDate: new Date("2024-01-15"),
        leaveBalances: { create: { year } },
        salaryStructure: {
          create: { monthlySalary: emp.salary, effectiveFrom: new Date("2024-01-15") },
        },
      },
      update: {},
    });
  }

  // Create an announcement
  await prisma.announcement.create({
    data: {
      title: "Welcome to META7MEDIA Office Manager",
      content: "Our new office management system is now live! Please check in daily and submit your leave requests through this system.",
      priority: 1,
      authorId: admin.id,
    },
  });

  // Create global holidays (officeId=null = applies to all offices).
  // Prisma's compound-unique types don't accept NULL in the `where` clause,
  // so we use findFirst+create instead of upsert.
  const ensureGlobalHoliday = async (name: string, dateStr: string) => {
    const date = new Date(dateStr);
    const existing = await prisma.holiday.findFirst({ where: { date, officeId: null } });
    if (!existing) {
      await prisma.holiday.create({ data: { name, date, year: date.getUTCFullYear() } });
    }
  };
  await ensureGlobalHoliday("Pakistan Day", `${year}-03-23`);
  await ensureGlobalHoliday("Independence Day", `${year}-08-14`);

  console.log("Seed completed!");
  console.log("");
  console.log("Login credentials (all users):");
  console.log("  Password: password123");
  console.log("");
  console.log("Accounts:");
  console.log("  Admin:    admin@meta7media.com");
  console.log("  HR:       hr@meta7media.com");
  console.log("  Manager:  manager@meta7media.com");
  console.log("  Employee: usman@meta7media.com (and others)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
