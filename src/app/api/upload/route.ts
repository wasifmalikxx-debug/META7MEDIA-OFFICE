import { NextRequest } from "next/server";
import { json, error, requireAuth } from "@/lib/api-helpers";
import path from "path";
import { writeFile, mkdir } from "fs/promises";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

    const ext = EXT_MAP[file.type] || "jpg";
    const userId = session.user.id;
    const timestamp = Date.now();
    const filename = `${timestamp}.${ext}`;

    const relDir = `uploads/review-bonus/${userId}`;
    const absDir = path.join(process.cwd(), "public", relDir);
    await mkdir(absDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(absDir, filename), buffer);

    return json({ url: `/${relDir}/${filename}` }, 201);
  } catch (err: any) {
    return error(err.message || "Upload failed", 500);
  }
}
