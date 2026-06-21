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

// POST /api/device-approval — Employee: register THIS device on login.
//
// Auth-gated: the caller must already hold a valid session (the login page
// calls this right after signIn succeeds). The userId is taken from the
// SESSION, never from the request body — otherwise an unauthenticated /
// spoofing caller could inject PENDING device rows for arbitrary users and
// pollute the CEO's approval queue.
export async function POST(request: NextRequest) {
  try {
    // deviceCheck:false — a user whose device is still PENDING must be able to
    // (re)register it; this is the one route that an unapproved-device session
    // legitimately needs while enforcement is on.
    const session = await requireAuth({ deviceCheck: false });
    if (!session) return error("Unauthorized", 401);
    const userId = session.user.id;

    const body = await request.json();
    const { fingerprint, deviceName } = body;

    // L24: validate + length-cap the client-supplied fields (they're stored and
    // rendered in the CEO's device-approval list).
    if (typeof fingerprint !== "string" || fingerprint.length < 1 || fingerprint.length > 256) {
      return error("Invalid fingerprint");
    }
    if (deviceName != null && (typeof deviceName !== "string" || deviceName.length > 120)) {
      return error("Invalid device name");
    }
    const safeDeviceName =
      (typeof deviceName === "string" ? deviceName.trim().slice(0, 120) : "") || "Unknown Device";

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
        deviceName: safeDeviceName,
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
