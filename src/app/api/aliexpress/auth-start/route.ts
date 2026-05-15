import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireAuth, error } from "@/lib/api-helpers";
import { buildAuthorizeUrl } from "@/lib/services/aliexpress-api.service";

/**
 * GET /api/aliexpress/auth-start
 *
 * Kicks off the AliExpress OAuth dance. CEO-only — we only need one
 * connected AliExpress seller account at the company level.
 *
 * Flow:
 *   1. Generate a CSRF state, drop it in an httpOnly cookie
 *   2. Redirect to AliExpress's authorize URL with our callback
 *   3. AliExpress redirects back to /api/aliexpress/callback?code=XXX&state=YYY
 *   4. Callback verifies state, exchanges code for token, stores it
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return error("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") {
    return error("CEO-only", 403);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("ali_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60, // 10 minutes is plenty
  });
  return res;
}
