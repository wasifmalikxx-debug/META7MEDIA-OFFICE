import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) return error("No file provided");
    if (!ALLOWED_TYPES.includes(file.type)) {
      return error("Only jpg, png, and webp files are allowed");
    }
    if (file.size > MAX_SIZE) {
      return error("File size must be under 5 MB");
    }

    // Convert to base64 data URL (works on Vercel — no filesystem needed)
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    return json({ url: dataUrl }, 201);
  } catch (err: any) {
    return error(err.message || "Upload failed", 500);
  }
}
