import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-memory settings cache (avoids querying DB on every request)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let cachedSettings: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 60 seconds

export async function getCachedSettings() {
  const now = Date.now();
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL) {
    return cachedSettings;
  }
  cachedSettings = await prisma.officeSettings.findUnique({ where: { id: "default" } });
  if (!cachedSettings) {
    cachedSettings = await prisma.officeSettings.create({ data: { id: "default" } });
  }
  cacheTimestamp = now;
  return cachedSettings;
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  cacheTimestamp = 0;
}
