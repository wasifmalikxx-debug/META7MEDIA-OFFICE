import { NextRequest } from "next/server";
import { json, error, requireAuth, requireRole, getClientIp } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

// GET /api/device-approval — Admin: list all pending/approved devices
export async function GET() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const devices = await prisma.deviceApproval.findMany({
    include: {
      user: {
        select: { firstName: true, lastName: true, employeeId: true, email: true },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return json(devices);
}

// POST /api/device-approval — Employee: register device on login
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, fingerprint, deviceName } = body;

    if (!userId || !fingerprint) {
      return error("userId and fingerprint required");
    }

    const ip = getClientIp(request);

    // Check if this device is already registered
    const existing = await prisma.deviceApproval.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
    });

    if (existing) {
      return json({ status: existing.status, id: existing.id });
    }

    // Create new pending device request
    const device = await prisma.deviceApproval.create({
      data: {
        userId,
        fingerprint,
        deviceName: deviceName || "Unknown Device",
        ipAddress: ip,
        status: "PENDING",
      },
    });

    return json({ status: "PENDING", id: device.id }, 201);
  } catch (err: any) {
    return error(err.message);
  }
}

// PATCH /api/device-approval — Admin: approve/reject device
export async function PATCH(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const { id, action } = body; // action: "approve" | "reject"

    if (!id || !action) return error("id and action required");

    const device = await prisma.deviceApproval.findUnique({ where: { id } });
    if (!device) return error("Device not found", 404);

    const updated = await prisma.deviceApproval.update({
      where: { id },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        approvedAt: action === "approve" ? new Date(Date.now() + 5 * 60 * 60_000) : null,
        rejectedAt: action === "reject" ? new Date(Date.now() + 5 * 60 * 60_000) : null,
      },
    });

    return json(updated);
  } catch (err: any) {
    return error(err.message);
  }
}

// DELETE /api/device-approval — Admin: remove a device
export async function DELETE(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return error("id required");

    await prisma.deviceApproval.delete({ where: { id } });
    return json({ success: true });
  } catch (err: any) {
    return error(err.message);
  }
}
