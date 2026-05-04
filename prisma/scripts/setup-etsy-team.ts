import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Setting up Etsy team with Izaan as Manager...\n");

  // 1. Find Izaan Kashif and upgrade to MANAGER
  const izaan = await prisma.user.findFirst({
    where: { firstName: "Izaan", lastName: "Kashif" },
  });

  if (!izaan) {
    console.error("Izaan Kashif not found!");
    return;
  }

  await prisma.user.update({
    where: { id: izaan.id },
    data: { role: "MANAGER" },
  });
  console.log(`  ✓ Izaan Kashif upgraded to MANAGER (${izaan.email})`);

  // 2. Find Etsy department in the primary office. (Department.name is no
  // longer globally unique post-multi-office; uniqueness is per-office now.)
  const primaryOffice = await prisma.office.findFirst({ where: { isPrimary: true } });
  const etsyDept = primaryOffice
    ? await prisma.department.findFirst({
        where: { name: "Etsy", officeId: primaryOffice.id },
      })
    : null;

  if (!etsyDept) {
    console.error("Etsy department not found!");
    return;
  }

  // 3. Set Izaan as manager for all Etsy employees
  const etsyEmployees = await prisma.user.findMany({
    where: {
      departmentId: etsyDept.id,
      role: "EMPLOYEE",
    },
  });

  for (const emp of etsyEmployees) {
    await prisma.user.update({
      where: { id: emp.id },
      data: { managerId: izaan.id },
    });
    console.log(`  ✓ ${emp.firstName} ${emp.lastName} → reports to Izaan`);
  }

  console.log(`\nDone! ${etsyEmployees.length} Etsy employees now report to Izaan.`);
  console.log("Izaan's role: MANAGER");
  console.log("Izaan can now approve review bonus submissions and manage Etsy team.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
