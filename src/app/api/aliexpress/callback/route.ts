import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForToken } from "@/lib/services/aliexpress-api.service";

/**
 * GET /api/aliexpress/callback
 *
 * The redirect target AliExpress hits after the user authorizes our app.
 * Registered URL: https://portal.meta7.media/api/aliexpress/callback
 *
 * Verifies CSRF state, exchanges the code for an access token, persists
 * to AliExpressToken, then bounces back to /seo-autopilot/product-hunter
 * with a success flag.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.redirect(
      new URL("/login?next=/seo-autopilot/product-hunter", request.url),
    );
  }
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const aliError = url.searchParams.get("error");

  // Error from AliExpress (e.g. user denied)
  if (aliError) {
    return NextResponse.redirect(
      new URL(
        `/seo-autopilot/product-hunter?aliConnect=denied&reason=${encodeURIComponent(aliError)}`,
        request.url,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        "/seo-autopilot/product-hunter?aliConnect=missing_code",
        request.url,
      ),
    );
  }

  // CSRF verification
  const cookieState = request.cookies.get("ali_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(
      new URL(
        "/seo-autopilot/product-hunter?aliConnect=state_mismatch",
        request.url,
      ),
    );
  }

  try {
    const token = await exchangeCodeForToken(code);
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    const refreshExpiresAt = token.refresh_token_valid_time
      ? new Date(token.refresh_token_valid_time)
      : null;

    await prisma.aliExpressToken.upsert({
      where: {
        userId_aliUserId: {
          userId: session.user.id,
          aliUserId: token.user_id ?? "default",
        },
      },
      update: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        aliUserNick: token.user_nick ?? null,
        expiresAt,
        refreshExpiresAt,
      },
      create: {
        userId: session.user.id,
        aliUserId: token.user_id ?? "default",
        aliUserNick: token.user_nick ?? null,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        refreshExpiresAt,
      },
    });

    const res = NextResponse.redirect(
      new URL(
        "/seo-autopilot/product-hunter?aliConnect=success",
        request.url,
      ),
    );
    res.cookies.delete("ali_oauth_state");
    return res;
  } catch (err) {
    console.error("[aliexpress] callback exchange failed:", err);
    const reason = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(
      new URL(
        `/seo-autopilot/product-hunter?aliConnect=exchange_failed&reason=${encodeURIComponent(reason.slice(0, 120))}`,
        request.url,
      ),
    );
  }
}
