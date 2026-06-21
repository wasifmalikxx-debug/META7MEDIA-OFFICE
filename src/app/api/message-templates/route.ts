import { json, error, serverError, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

const DEFAULT_TEMPLATES = [
  {
    type: "LATE_FINE_10",
    title: "Late Fine (10 min)",
    template:
      "🚨 *META7MEDIA — FINE ALERT*\n━━━━━━━━━━━━━━━━━━━━\n\nHi {name},\n\n⏰ You arrived *{minutes} minutes late* today.\n💸 Fine: *PKR {amount}*\n\n📊 This will be deducted from your monthly salary.\n💡 _Tip: Arrive before 11:10 AM to avoid fines._\n\n⚙️ _System-generated — cannot be modified._\n━━━━━━━━━━━━━━━━━━━━\nMETA7 AI | Office Manager",
  },
  {
    type: "LATE_FINE_30",
    title: "Late Fine (30 min)",
    template:
      "🚨 *META7MEDIA — FINE ALERT*\n━━━━━━━━━━━━━━━━━━━━\n\nHi {name},\n\n⏰ You arrived *{minutes} minutes late* today.\n💸 Fine: *PKR {amount}*\n\n📊 This will be deducted from your monthly salary.\n💡 _Tip: Arriving 30+ min late doubles your fine._\n\n⚙️ _System-generated — cannot be modified._\n━━━━━━━━━━━━━━━━━━━━\nMETA7 AI | Office Manager",
  },
  {
    type: "LATE_FINE_60",
    title: "Late Fine (60 min)",
    template:
      "🚨 *META7MEDIA — FINE ALERT*\n━━━━━━━━━━━━━━━━━━━━\n\nHi {name},\n\n⏰ You arrived *{minutes} minutes late* today.\n💸 Fine: *PKR {amount}*\n\n📊 This will be deducted from your monthly salary.\n⚠️ _60+ min late is the maximum fine tier._\n\n⚙️ _System-generated — cannot be modified._\n━━━━━━━━━━━━━━━━━━━━\nMETA7 AI | Office Manager",
  },
  {
    type: "BREAK_FINE",
    title: "Break Fine",
    template:
      "🚨 *META7MEDIA — BREAK FINE*\n━━━━━━━━━━━━━━━━━━━━\n\nHi {name},\n\n☕ You returned *{minutes} minutes late* from break.\n💸 Fine: *PKR {amount}*\n\n📊 This will be deducted from your monthly salary.\n💡 _Tip: Break ends at 4:00 PM — return within 5 min grace._\n\n⚙️ _System-generated — cannot be modified._\n━━━━━━━━━━━━━━━━━━━━\nMETA7 AI | Office Manager",
  },
  {
    type: "ABSENT",
    title: "Absent Notice",
    template:
      "🔴 *META7MEDIA — ABSENT NOTICE*\n━━━━━━━━━━━━━━━━━━━━\n\nHi {name},\n\n❌ You were marked *ABSENT* today.\n💸 Deduction: *PKR {amount}* (daily rate)\n\n📊 This will be reflected in your monthly salary.\n📌 _If incorrect, contact the CEO immediately._\n\n⚙️ _System-generated — cannot be modified._\n━━━━━━━━━━━━━━━━━━━━\nMETA7 AI | Office Manager",
  },
  {
    type: "SALARY_PAID",
    title: "Salary Credited",
    template:
      "💰 *META7MEDIA — SALARY CREDITED!*\n━━━━━━━━━━━━━━━━━━━━\n\nHi *{name}*,\n\n📅 Month: *{month}*\n💵 Net Salary: *PKR {amount}*\n✅ Status: *PAID*\n\n🏦 Payment processed via Bank Alfalah.\nCheck your payroll for full breakdown.\n\n🙏 Thank you for your dedication!\n━━━━━━━━━━━━━━━━━━━━\nMETA7MEDIA Management 🏢",
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
    return serverError(err, "Something went wrong. Please try again.", 400);
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
    return serverError(err, "Something went wrong. Please try again.", 400);
  }
}
