import { json, error, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

const DEFAULT_TEMPLATES = [
  {
    type: "LATE_FINE_10",
    title: "Late Fine (10 min)",
    template:
      "META7 AI: Fine Alert — {name}, you've been fined PKR {amount} for arriving {minutes} minutes late. This is system-generated and cannot be modified.",
  },
  {
    type: "LATE_FINE_30",
    title: "Late Fine (30 min)",
    template:
      "META7 AI: Fine Alert — {name}, you've been fined PKR {amount} for arriving {minutes} minutes late. This is system-generated and cannot be modified.",
  },
  {
    type: "LATE_FINE_60",
    title: "Late Fine (60 min)",
    template:
      "META7 AI: Fine Alert — {name}, you've been fined PKR {amount} for arriving {minutes} minutes late. This is system-generated and cannot be modified.",
  },
  {
    type: "BREAK_FINE",
    title: "Break Fine",
    template:
      "META7 AI: Fine Alert — {name}, you've been fined PKR {amount} for returning late from break. This is system-generated and cannot be modified.",
  },
  {
    type: "ABSENT",
    title: "Absent Fine",
    template:
      "META7 AI: Absent Alert — {name}, you were marked absent today. PKR {amount} has been deducted (salary/30). This is system-generated.",
  },
  {
    type: "SALARY_PAID",
    title: "Salary Paid",
    template:
      "META7 AI: Salary Credited — {name}, your salary of PKR {amount} for {month} has been processed. Check your payroll for details.",
  },
];

// GET /api/message-templates — list all templates (seed defaults if empty)
export async function GET() {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    let templates = await prisma.messageTemplate.findMany({
      orderBy: { type: "asc" },
    });

    // Seed defaults if none exist
    if (templates.length === 0) {
      await prisma.messageTemplate.createMany({
        data: DEFAULT_TEMPLATES,
      });
      templates = await prisma.messageTemplate.findMany({
        orderBy: { type: "asc" },
      });
    }

    return json(templates);
  } catch (err: any) {
    return error(err.message);
  }
}

// PUT /api/message-templates — update a single template
export async function PUT(request: Request) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const { id, template, enabled } = await request.json();
    if (!id) return error("Template ID is required");

    const data: any = {};
    if (typeof template === "string") data.template = template;
    if (typeof enabled === "boolean") data.enabled = enabled;

    const updated = await prisma.messageTemplate.update({
      where: { id },
      data,
    });

    return json(updated);
  } catch (err: any) {
    return error(err.message);
  }
}
