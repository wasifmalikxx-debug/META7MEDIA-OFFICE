/**
 * Duplicate-listing detection for Daily Reports.
 *
 * Scans the last 3 months of DailyReport rows, extracts Etsy listing IDs
 * from every submitted link, and flags any listing ID that appears in more
 * than one row (or twice within the same row). The earliest submission is
 * the canonical "first occurrence"; every later appearance is a duplicate.
 *
 * We match on the numeric Etsy listing ID (e.g. 12345 from
 * `https://www.etsy.com/listing/12345/slug?ref=...`) so all query-string
 * and path variants of the same listing resolve to one ID. URLs without
 * an Etsy listing ID are ignored — no false positives.
 */

export interface DuplicateHit {
  /** The original link as submitted (trimmed) */
  link: string;
  /** The listing ID the duplicate was matched on */
  listingId: string;
  /** Info about the earliest submission of this same listing */
  firstSubmission: {
    reportId: string;
    employeeId: string;
    employeeName: string;
    date: string; // ISO yyyy-mm-dd
    sameReport: boolean; // true = duplicate within the same daily report
  };
}

export type DuplicatesByReport = Record<string, DuplicateHit[]>;

/**
 * Pull the numeric Etsy listing ID out of any common Etsy URL format.
 * Returns null for anything without one — we never flag non-Etsy URLs.
 */
export function extractEtsyListingId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  // Match /listing/<digits> anywhere in the URL. Covers:
  //   https://www.etsy.com/listing/12345/slug
  //   https://www.etsy.com/shop/Store/listing/12345?ref=...
  //   etsy.com/listing/12345
  const match = url.match(/\/listing\/(\d+)/i);
  return match ? match[1] : null;
}

interface ReportLike {
  id: string;
  date: Date | string;
  createdAt?: Date | string;
  listingLinks: string | null;
  user: {
    firstName: string;
    lastName: string | null;
    employeeId: string;
  };
}

/**
 * Given a flat list of DailyReport rows (ordered oldest-first by date, then
 * createdAt), return a map from reportId → list of duplicate hits.
 *
 * Reports not in the returned map have zero duplicates. This keeps the
 * payload small and the caller's code branch-free.
 */
export function computeDuplicates(reports: ReportLike[]): DuplicatesByReport {
  // Map<listingId, firstSubmission> — the earliest report that contained
  // this listing ID. "Earliest" is derived from the iteration order of the
  // input array, so reports MUST be pre-sorted ASC by (date, createdAt).
  const firstSeen = new Map<
    string,
    {
      reportId: string;
      employeeId: string;
      employeeName: string;
      date: string;
    }
  >();

  // Pass 1: record the first occurrence of each listing ID across ALL reports.
  for (const r of reports) {
    const links = (r.listingLinks || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const seenInThisReport = new Set<string>();
    for (const link of links) {
      const id = extractEtsyListingId(link);
      if (!id) continue;
      if (seenInThisReport.has(id)) continue; // same report, same link — only count first
      seenInThisReport.add(id);
      if (!firstSeen.has(id)) {
        firstSeen.set(id, {
          reportId: r.id,
          employeeId: r.user.employeeId,
          employeeName: `${r.user.firstName} ${r.user.lastName || ""}`.trim(),
          date: toIsoDate(r.date),
        });
      }
    }
  }

  // Pass 2: for every report, collect which of its links are duplicates.
  const out: DuplicatesByReport = {};
  for (const r of reports) {
    const links = (r.listingLinks || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const seenInThisReport = new Set<string>();
    const hits: DuplicateHit[] = [];

    for (const link of links) {
      const id = extractEtsyListingId(link);
      if (!id) continue;

      const first = firstSeen.get(id);
      if (!first) continue; // shouldn't happen — defensive

      // Case A: this link's origin is a DIFFERENT report → always a dup
      if (first.reportId !== r.id) {
        hits.push({
          link,
          listingId: id,
          firstSubmission: { ...first, sameReport: false },
        });
        continue;
      }

      // Case B: this link's origin is THIS report.
      // First time we see it in this loop = not a duplicate.
      // Every subsequent time = internal duplicate (pasted twice in same report).
      if (seenInThisReport.has(id)) {
        hits.push({
          link,
          listingId: id,
          firstSubmission: { ...first, sameReport: true },
        });
      } else {
        seenInThisReport.add(id);
      }
    }

    if (hits.length > 0) out[r.id] = hits;
  }

  return out;
}

function toIsoDate(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
