import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProfileView, type ProfileUser } from "@/components/profile/profile-view";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      employeeId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      phone2: true,
      role: true,
      status: true,
      designation: true,
      joiningDate: true,
      bankName: true,
      accountNumber: true,
      accountTitle: true,
      department: { select: { name: true } },
    },
  });

  if (!user) redirect("/login");

  // Serialised here rather than handed to the client raw: joiningDate is a
  // Date, and `select` keeps this to the columns the page actually renders
  // (the old query pulled the whole row plus salaryStructure, which nothing
  // on the page ever used).
  const profile: ProfileUser = {
    employeeId: user.employeeId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone || "",
    phone2: user.phone2 || "",
    role: user.role,
    status: user.status,
    designation: user.designation,
    department: user.department?.name ?? null,
    joiningDate: user.joiningDate ? user.joiningDate.toISOString() : null,
    isCeo: user.role === "SUPER_ADMIN",
    bankName: user.bankName,
    accountNumber: user.accountNumber,
    accountTitle: user.accountTitle,
  };

  return <ProfileView user={profile} />;
}
