import crypto from "node:crypto";

/**
 * M20: at-rest encryption for stored secrets (currently the AliExpress OAuth
 * access/refresh tokens). AES-256-GCM with a key derived from the
 * ENCRYPTION_KEY env var.
 *
 * ROLLOUT-SAFE by design — nothing breaks before the key is set:
 *   - encryptSecret(): if ENCRYPTION_KEY is unset, returns the value UNCHANGED
 *     (stored as plaintext, exactly like today). Once the key is set, new
 *     writes are encrypted and tagged with the "enc:v1:" marker.
 *   - decryptSecret(): values WITHOUT the marker are treated as plaintext and
 *     returned as-is (handles legacy rows + the no-key case). Marked values are
 *     decrypted; if the key is missing/wrong it logs and returns "" rather than
 *     throwing, so a misconfig degrades the feature instead of crashing.
 *
 * To activate: set ENCRYPTION_KEY (any length — it's SHA-256'd to 32 bytes) in
 * the Vercel project env. Existing plaintext tokens keep working; they become
 * encrypted the next time they're written (e.g. on token refresh).
 */

const MARKER = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  // SHA-256 → exactly 32 bytes, so any-length env value works.
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plaintext: string | null | undefined): string {
  const value = plaintext ?? "";
  const key = getKey();
  if (!key) return value; // no key → behave exactly like today (plaintext)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MARKER + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(stored: string | null | undefined): string {
  if (stored == null) return "";
  if (!stored.startsWith(MARKER)) return stored; // plaintext / legacy → as-is
  const key = getKey();
  if (!key) {
    console.error("[crypto] encountered an encrypted value but ENCRYPTION_KEY is not set");
    return "";
  }
  try {
    const buf = Buffer.from(stored.slice(MARKER.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch (err) {
    console.error("[crypto] decrypt failed:", (err as Error).message);
    return "";
  }
}
