import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Role } from "@prisma/client";

export function json(data: any, status = 200, cacheSeconds = 0) {
  const headers: Record<string, string> = {};
  if (cacheSeconds > 0) {
    headers["Cache-Control"] = `s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`;
  }
  return NextResponse.json(data, { status, headers });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function getSession() {
  return auth();
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) return null;
  return session;
}

export async function requireRole(...roles: Role[]) {
  const session = await requireAuth();
  if (!session) return null;
  const userRole = (session.user as any).role as Role;
  if (!roles.includes(userRole)) return null;
  return session;
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}
