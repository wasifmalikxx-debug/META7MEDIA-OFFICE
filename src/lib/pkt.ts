/**
 * Pakistan Standard Time (PKT = UTC+5) utility functions.
 * Use these EVERYWHERE instead of raw Date math.
 */

const PKT_OFFSET_MS = 5 * 60 * 60_000; // 5 hours in milliseconds
const PKT_OFFSET_MIN = 300; // 5 hours in minutes
const DAY_MINUTES = 1440;

/** Get current time in PKT as a Date (shifted to PKT) */
export function nowPKT(): Date {
  return new Date(Date.now() + PKT_OFFSET_MS);
}

/** Get today's date at midnight UTC, representing today in PKT */
export function todayPKT(): Date {
  const pkt = nowPKT();
  return new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()));
}

/** Get current PKT minutes since midnight (0-1439) */
export function pktMinutesSinceMidnight(): number {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  let pktMinutes = utcMinutes + PKT_OFFSET_MIN;
  if (pktMinutes >= DAY_MINUTES) pktMinutes -= DAY_MINUTES;
  return pktMinutes;
}

/** Get PKT month (1-12) */
export function pktMonth(): number {
  return nowPKT().getUTCMonth() + 1;
}

/** Get PKT year */
export function pktYear(): number {
  return nowPKT().getUTCFullYear();
}

/** Get start of current PKT month as UTC Date */
export function startOfMonthPKT(): Date {
  const pkt = nowPKT();
  return new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), 1));
}

/** Get end of current PKT month as UTC Date */
export function endOfMonthPKT(): Date {
  const pkt = nowPKT();
  return new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth() + 1, 0));
}

/** Format a Date to PKT date string (YYYY-MM-DD) */
export function formatPKTDate(date: Date): string {
  const pkt = new Date(date.getTime() + PKT_OFFSET_MS);
  const y = pkt.getUTCFullYear();
  const m = String(pkt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(pkt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Normalize a phone number to international format for WhatsApp */
export function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  // Remove spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");
  // Convert Pakistani local format to international
  if (cleaned.startsWith("03") && cleaned.length === 11) {
    cleaned = "+92" + cleaned.substring(1);
  }
  // Ensure starts with +
  if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }
  // Validate minimum length (country code + number)
  if (cleaned.length < 10) return null;
  return cleaned;
}
