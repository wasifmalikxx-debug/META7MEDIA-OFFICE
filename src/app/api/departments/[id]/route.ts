import { NextRequest } from "next/server";
import { json, error, serverError, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;
  const body = await request.json();

  if (!body.name) return error("Department name is required");

  try {
    // Allow the CEO to move a department between offices via the Edit
    // dialog. If `officeId` is missing the office assignment stays put.
    const updateData: { name: string; officeId?: string } = { name: body.name };
    if (typeof body.officeId === "string" && body.officeId.length > 0) {
      const exists = await prisma.office.findUnique({ where: { id: body.officeId }, select: { id: true } });
      if (!exists) return error("Invalid office", 400);
      updateData.officeId = body.officeId;
    }
    const department = await prisma.department.update({
      where: { id },
      data: updateData,
    });
    return json(department);
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.includes("Unique constraint")) {
      return error("A department with that name already exists in the target office.");
    }
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  const { id } = await params;

  try {
    // Unassign employees from this department
    await prisma.user.updateMany({
      where: { departmentId: id },
      data: { departmentId: null },
    });

    await prisma.department.delete({ where: { id } });
    return json({ success: true });
  } catch (err: any) {
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
