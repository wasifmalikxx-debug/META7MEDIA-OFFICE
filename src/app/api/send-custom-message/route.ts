import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/services/whatsapp.service";

// POST /api/send-custom-message — send a custom WhatsApp message
export async function POST(request: Request) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const { message, employeeIds } = await request.json();
    if (!message) return error("Message is required");
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0)
      return error("At least one employee must be selected");

    const isAll = employeeIds.includes("ALL");

    const employees = isAll
      ? await prisma.user.findMany({
          where: { status: { in: ["HIRED", "PROBATION"] }, phone: { not: null } },
          select: { id: true, phone: true, firstName: true },
        })
      : await prisma.user.findMany({
          where: { id: { in: employeeIds }, phone: { not: null } },
          select: { id: true, phone: true, firstName: true },
        });

    let sentCount = 0;
    for (const emp of employees) {
      if (emp.phone) {
        const sent = await sendWhatsApp(emp.phone, message);
        if (sent) sentCount++;
      }
    }

    // Save to history
    await prisma.customMessage.create({
      data: {
        message,
        sentTo: isAll ? "ALL" : employeeIds.join(","),
        sentBy: (session.user as any).id || "SUPER_ADMIN",
      },
    });

    return json({ success: true, sentCount, total: employees.length });
  } catch (err: any) {
    return error(err.message);
  }
}

// GET /api/send-custom-message — get message history
export async function GET() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const messages = await prisma.customMessage.findMany({
      orderBy: { sentAt: "desc" },
      take: 10,
    });
    return json(messages);
  } catch (err: any) {
    return error(err.message);
  }
}
