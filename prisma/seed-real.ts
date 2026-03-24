import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Updating database with real employee data...");

  const password = await bcrypt.hash("password123", 12);
  const year = new Date().getFullYear();

  // Ensure office settings exist
  await prisma.officeSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  // Delete old test departments and create real ones
  // First remove department references from users
  await prisma.user.updateMany({ data: { departmentId: null, teamId: null, managerId: null } });
  await prisma.team.deleteMany({});
  await prisma.department.deleteMany({});

  const etsyDept = await prisma.department.create({ data: { name: "Etsy" } });
  const fbDept = await prisma.department.create({ data: { name: "Facebook" } });

  // Delete all non-admin users (keep admin account)
  const admin = await prisma.user.findUnique({ where: { email: "admin@meta7media.com" } });
  if (admin) {
    // Delete related records for all users except admin
    const nonAdminUsers = await prisma.user.findMany({
      where: { id: { not: admin.id } },
      select: { id: true },
    });
    const nonAdminIds = nonAdminUsers.map((u) => u.id);

    if (nonAdminIds.length > 0) {
      await prisma.notification.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.fine.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.incentive.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.payrollRecord.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.leaveRequest.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.leaveBalance.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.attendance.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.warning.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.salaryStructure.deleteMany({ where: { userId: { in: nonAdminIds } } });
      await prisma.user.deleteMany({ where: { id: { in: nonAdminIds } } });
    }

    // Update admin user
    await prisma.user.update({
      where: { id: admin.id },
      data: { status: "HIRED" },
    });
  }

  // Also clean admin's related fines/incentives issued
  await prisma.fine.deleteMany({});
  await prisma.incentive.deleteMany({});

  const employees = [
    // ─── ETSY EMPLOYEES ───
    {
      employeeId: "M7M-E01",
      email: "sufyan@meta7media.com",
      firstName: "Muhammad",
      lastName: "Sufyan",
      status: "HIRED" as const,
      joiningDate: new Date("2024-10-16"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Meezan Bank",
      accountNumber: "00300110239903",
      accountTitle: "Muhammad Sufyan",
    },
    {
      employeeId: "M7M-E02",
      email: "ammar@meta7media.com",
      firstName: "Ammar",
      lastName: "Ahsan",
      status: "HIRED" as const,
      joiningDate: new Date("2024-11-01"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Meezan Bank",
      accountNumber: "00300113934737",
      accountTitle: "AMMAR EHSAN",
    },
    {
      employeeId: "M7M-E03",
      email: "ehtisham@meta7media.com",
      firstName: "Muhammad",
      lastName: "Ehtisham",
      status: "HIRED" as const,
      joiningDate: new Date("2024-11-01"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Faisal Bank",
      accountNumber: "3233525000003916",
      accountTitle: "Ehtisham",
    },
    {
      employeeId: "M7M-E04",
      email: "kashan@meta7media.com",
      firstName: "Kashan",
      lastName: "Munir Tahir",
      status: "HIRED" as const,
      joiningDate: new Date("2024-11-01"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Bank Alfalah",
      accountNumber: "56255001477208",
      accountTitle: "KASHAN MUNEER TAHIR",
    },
    {
      employeeId: "M7M-E05",
      email: "musa@meta7media.com",
      firstName: "Muhammad",
      lastName: "Musa",
      status: "HIRED" as const,
      joiningDate: new Date("2025-01-13"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Sadapay",
      accountNumber: "03228600800",
      accountTitle: "Muhammad Musa",
    },
    {
      employeeId: "M7M-E06",
      email: "areefa@meta7media.com",
      firstName: "Areefa",
      lastName: "Arshad",
      status: "HIRED" as const,
      joiningDate: new Date("2025-02-10"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Meezan Bank",
      accountNumber: "12610104767901",
      accountTitle: "Areefa Arshad",
    },
    {
      employeeId: "M7M-E07",
      email: "zabreen@meta7media.com",
      firstName: "Zabreen",
      lastName: "Sheikh",
      status: "HIRED" as const,
      joiningDate: new Date("2025-01-25"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Meezan Bank",
      accountNumber: "01980110592351",
      accountTitle: "Zabreen",
    },
    {
      employeeId: "M7M-E08",
      email: "mairaabid@meta7media.com",
      firstName: "Maira",
      lastName: "Abid",
      status: "HIRED" as const,
      joiningDate: new Date("2025-02-19"),
      salary: 35000,
      dept: etsyDept.id,
      bankName: "Meezan Bank (IZMIR SOCIETY BRANCH)",
      accountNumber: "11640113156844",
      accountTitle: "MAIRA ABID",
    },
    {
      employeeId: "M7M-E09",
      email: "izaan@meta7media.com",
      firstName: "Izaan",
      lastName: "Kashif",
      status: "HIRED" as const,
      joiningDate: new Date("2025-06-14"),
      salary: 40000,
      dept: etsyDept.id,
      bankName: "Bank Alfalah",
      accountNumber: "03581010578379",
      accountTitle: "Izaan Kashif",
    },

    // ─── FB EMPLOYEES ───
    {
      employeeId: "M7M-F01",
      email: "hadeed@meta7media.com",
      firstName: "Hadeed",
      lastName: "Ur Rehman",
      status: "HIRED" as const,
      joiningDate: new Date("2024-12-01"),
      salary: 35000,
      dept: fbDept.id,
      bankName: "Meezan Bank",
      accountNumber: "11470114302154",
      accountTitle: "RAI HADEED UR REHMAN",
    },
    {
      employeeId: "M7M-F02",
      email: "ahmad@meta7media.com",
      firstName: "M. Ahmad",
      lastName: "Aslam",
      status: "HIRED" as const,
      joiningDate: new Date("2025-06-10"),
      salary: 40000,
      dept: fbDept.id,
      bankName: "Meezan Bank",
      accountNumber: "11660111163304",
      accountTitle: "Muhammad Ahmad",
    },
    {
      employeeId: "M7M-F03",
      email: "maira@meta7media.com",
      firstName: "Maira",
      lastName: "",
      status: "HIRED" as const,
      joiningDate: new Date("2025-01-01"),
      salary: 35000,
      dept: fbDept.id,
      bankName: "UBL",
      accountNumber: "PK69UNIL0109000327979245",
      accountTitle: "Maira",
    },
    {
      employeeId: "M7M-F04",
      email: "mohsin@meta7media.com",
      firstName: "Mohsin",
      lastName: "Raza",
      status: "HIRED" as const,
      joiningDate: new Date("2025-02-16"),
      salary: 35000,
      dept: fbDept.id,
      bankName: "MCB Bank",
      accountNumber: "1630320471011331",
      accountTitle: "Mohsin Raza",
    },
    {
      employeeId: "M7M-F05",
      email: "basil@meta7media.com",
      firstName: "Muhammad",
      lastName: "Basil",
      status: "PROBATION" as const,
      joiningDate: new Date("2025-03-01"),
      salary: 30000,
      dept: fbDept.id,
      bankName: null,
      accountNumber: null,
      accountTitle: null,
    },
    {
      employeeId: "M7M-F06",
      email: "hamza@meta7media.com",
      firstName: "Rana Hamza",
      lastName: "Rehman",
      status: "PROBATION" as const,
      joiningDate: new Date("2025-03-01"),
      salary: 30000,
      dept: fbDept.id,
      bankName: null,
      accountNumber: null,
      accountTitle: null,
    },
    {
      employeeId: "M7M-F07",
      email: "abdul@meta7media.com",
      firstName: "Abdul",
      lastName: "Ahad",
      status: "PROBATION" as const,
      joiningDate: new Date("2025-03-01"),
      salary: 30000,
      dept: fbDept.id,
      bankName: null,
      accountNumber: null,
      accountTitle: null,
    },
    {
      employeeId: "M7M-F08",
      email: "sami@meta7media.com",
      firstName: "Sami",
      lastName: "Ahmed",
      status: "PROBATION" as const,
      joiningDate: new Date("2025-02-19"),
      salary: 35000,
      dept: fbDept.id,
      bankName: "United Bank Limited",
      accountNumber: "0575324104288",
      accountTitle: "Sami Ahmad",
    },
    {
      employeeId: "M7M-F09",
      email: "maroof@meta7media.com",
      firstName: "Maroof",
      lastName: "Tahir",
      status: "HIRED" as const,
      joiningDate: new Date("2024-12-01"),
      salary: 40000,
      dept: fbDept.id,
      bankName: "HBL",
      accountNumber: "58137000131961",
      accountTitle: "MAROOF",
    },
    {
      employeeId: "M7M-F10",
      email: "abutalha@meta7media.com",
      firstName: "Abu Talha",
      lastName: "Arshad",
      status: "HIRED" as const,
      joiningDate: new Date("2025-01-13"),
      salary: 35000,
      dept: fbDept.id,
      bankName: "Alfalah",
      accountNumber: "55015001622147",
      accountTitle: "ABU TALHA ARSHAD",
    },
  ];

  for (const emp of employees) {
    await prisma.user.create({
      data: {
        employeeId: emp.employeeId,
        email: emp.email,
        password,
        firstName: emp.firstName,
        lastName: emp.lastName,
        role: "EMPLOYEE",
        status: emp.status,
        joiningDate: emp.joiningDate,
        departmentId: emp.dept,
        bankName: emp.bankName,
        accountNumber: emp.accountNumber,
        accountTitle: emp.accountTitle,
        leaveBalances: { create: { year } },
        salaryStructure: {
          create: { monthlySalary: emp.salary, effectiveFrom: emp.joiningDate },
        },
      },
    });
    console.log(`  ✓ ${emp.firstName} ${emp.lastName} (${emp.employeeId})`);
  }

  console.log(`\nDone! Created ${employees.length} employees.`);
  console.log("\nDepartments: Etsy, Facebook");
  console.log("All employee passwords: password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
