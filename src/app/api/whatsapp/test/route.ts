import { json, error, requireRole } from "@/lib/api-helpers";
import { sendWhatsApp } from "@/lib/services/whatsapp.service";

// POST /api/whatsapp/test — Admin only test endpoint
export async function POST(request: Request) {
  const session = await requireRole("SUPER_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const { to, message } = await request.json();
    if (!to || !message) return error("'to' and 'message' required");

    const sent = await sendWhatsApp(to, message);
    return json({ success: sent, to, message });
  } catch (err: any) {
    return error(err.message);
  }
}
