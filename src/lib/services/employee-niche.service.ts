import { prisma } from "@/lib/prisma";

/**
 * Employee niche service — CRUD over the `EmployeeNiche` table.
 *
 * Each Etsy employee owns a list of niches (free-form strings) that
 * drive the daily trending fetcher. The service enforces:
 *   - Hard cap of 5 niches per employee (cron load control)
 *   - Case-insensitive uniqueness within a user's niche book
 *   - Lower-cased + trimmed storage so "Boho Jewelry" and "boho jewelry"
 *     aren't stored twice
 *
 * Live since May 16 2026 (CEO + EM team rollout).
 */

export const NICHE_CAP_PER_USER = 5;
export const NICHE_MIN_LENGTH = 2;
export const NICHE_MAX_LENGTH = 80;

export interface EmployeeNicheRow {
  id: string;
  niche: string;
  active: boolean;
  createdAt: Date;
}

/**
 * Normalize a raw niche string before insert/compare. We trim, collapse
 * internal whitespace, and lowercase. Caps the length at NICHE_MAX_LENGTH
 * so the @db.VarChar(80) constraint is never tripped.
 */
export function normalizeNiche(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, NICHE_MAX_LENGTH);
}

/**
 * List a user's niches in stable order (oldest first — matches insertion
 * order so the user's first-added niches stay at the top).
 */
export async function listNiches(userId: string): Promise<EmployeeNicheRow[]> {
  return prisma.employeeNiche.findMany({
    where: { userId },
    select: { id: true, niche: true, active: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Add a niche for a user. Returns the new row, or throws an Error with
 * a code-like message the API route translates into a 4xx status:
 *   - "INVALID_LENGTH" → 400
 *   - "CAP_REACHED"    → 409
 *   - "DUPLICATE"      → 409
 */
export async function addNiche(
  userId: string,
  rawNiche: string,
): Promise<EmployeeNicheRow> {
  const niche = normalizeNiche(rawNiche);
  if (niche.length < NICHE_MIN_LENGTH) {
    throw new Error("INVALID_LENGTH");
  }

  // Cap check inside a transaction so two parallel POSTs can't both
  // squeeze in a 6th niche.
  return prisma.$transaction(async (tx) => {
    const existing = await tx.employeeNiche.findMany({
      where: { userId },
      select: { id: true, niche: true },
    });
    if (existing.length >= NICHE_CAP_PER_USER) {
      throw new Error("CAP_REACHED");
    }
    if (existing.some((n) => n.niche === niche)) {
      throw new Error("DUPLICATE");
    }

    const row = await tx.employeeNiche.create({
      data: { userId, niche, active: true },
      select: { id: true, niche: true, active: true, createdAt: true },
    });
    return row;
  });
}

/**
 * Hard-delete a niche. Only the owner can delete (caller checks).
 * Returns true if a row was removed, false if it didn't exist.
 */
export async function deleteNiche(
  userId: string,
  nicheId: string,
): Promise<boolean> {
  const row = await prisma.employeeNiche.findUnique({
    where: { id: nicheId },
    select: { userId: true },
  });
  if (!row) return false;
  if (row.userId !== userId) {
    // Someone tried to delete another user's niche. Surface as 404 not
    // 403 so we don't leak existence.
    return false;
  }
  await prisma.employeeNiche.delete({ where: { id: nicheId } });
  return true;
}

/**
 * Distinct list of all active niches across every user. Used by the
 * daily-trending cron — one AE call per unique niche, regardless of
 * how many employees share it.
 */
export async function listAllActiveNichesDistinct(): Promise<string[]> {
  const rows = await prisma.employeeNiche.findMany({
    where: { active: true },
    select: { niche: true },
    distinct: ["niche"],
  });
  return rows.map((r) => r.niche);
}

/**
 * Suggested niche pool — shown as one-click chips inside the Manage
 * Niches modal when an employee has < 5 niches. Curated to match the
 * shop categories the Etsy team usually works.
 */
export const SUGGESTED_NICHES: ReadonlyArray<string> = [
  "boho jewelry",
  "minimalist jewelry",
  "cottagecore decor",
  "farmhouse wall art",
  "minimalist nursery",
  "baby shower gifts",
  "witchy decor",
  "bridesmaid gifts",
  "anniversary gift",
  "personalized keychain",
  "silver jewelry",
  "gold jewelry",
  "travel mug",
  "candle holder",
  "kitchen wall art",
  "boho wall hanging",
  "macrame decor",
  "phone case minimalist",
  "leather wallet",
  "embroidered hat",
  "pet portrait",
  "garden decor",
  "yoga gift",
  "mental health gift",
  "teacher appreciation",
];
