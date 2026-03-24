import { prisma } from "@/lib/prisma";
import { NotificationType } from "@prisma/client";

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  linkUrl?: string
) {
  return prisma.notification.create({
    data: { userId, type, title, message, linkUrl },
  });
}

export async function notifyAdmins(
  type: NotificationType,
  title: string,
  message: string,
  linkUrl?: string
) {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "HR_ADMIN"] }, status: { in: ["HIRED", "PROBATION"] } },
    select: { id: true },
  });

  return prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      type,
      title,
      message,
      linkUrl,
    })),
  });
}
