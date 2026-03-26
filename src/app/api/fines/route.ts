import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { fineSchema } from "@/lib/validations/payroll";
import { createNotification } from "@/lib/services/notification.service";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const role = (session.user as any).role;
  const userId = searchParams.get("userId");
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = parseInt(searchParams.get("month") || String(_pkt.getUTCMonth() + 1));
  const year = parseInt(searchParams.get("year") || String(_pkt.getUTCFullYear()));

  const where: any = { month, year };
  if (role === "EMPLOYEE") {
    where.userId = session.user.id;
  } else if (userId) {
    where.userId = userId;
  }

  const fines = await prisma.fine.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, employeeId: true } },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json(fines);
}

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const parsed = fineSchema.parse(body);

    const fineDate = new Date(parsed.date);
    fineDate.setHours(0, 0, 0, 0);

    const fine = await prisma.fine.create({
      data: {
        userId: parsed.userId,
        type: parsed.type as any,
        amount: parsed.amount,
        reason: parsed.reason,
        date: fineDate,
        month: fineDate.getMonth() + 1,
        year: fineDate.getFullYear(),
        issuedById: session.user.id,
      },
    });

    await createNotification(
      parsed.userId,
      "FINE_ISSUED",
      "Fine Issued",
      `A fine of PKR ${parsed.amount.toLocaleString()} has been issued. Reason: ${parsed.reason}`,
      "/fines"
    );

    // WhatsApp notification via template (fire-and-forget)
    try {
      const { sendManualFineTemplate } = await import("@/lib/services/whatsapp.service");
      const user = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { firstName: true, lastName: true, phone: true } });
      const empName = user ? `${user.firstName} ${user.lastName || ""}`.trim() : "Employee";
      console.log(`[FINE] Sending manual fine WhatsApp to ${user?.phone} for ${empName}, amount: ${parsed.amount}, reason: ${parsed.reason}`);
      if (user?.phone) {
        const sent = await sendManualFineTemplate(user.phone, empName, parsed.amount, parsed.reason);
        console.log(`[FINE] WhatsApp result: ${sent ? "SENT" : "FAILED"}`);
      } else {
        console.log(`[FINE] No phone number for user ${parsed.userId}`);
      }
    } catch (err: any) {
      console.error("[FINE] WhatsApp error:", err.message);
    }

    // Sync payroll record
    try {
      const { syncPayrollRecord } = await import("@/lib/services/payroll-sync.service");
      await syncPayrollRecord(parsed.userId, fineDate.getMonth() + 1, fineDate.getFullYear());
    } catch {}

    return json(fine, 201);
  } catch (err: any) {
    return error(err.message);
  }
}
