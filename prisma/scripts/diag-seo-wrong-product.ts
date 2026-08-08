/**
 * READ-ONLY — hunt for the "description describes the wrong product" bug.
 * Scans recent SeoAutopilotLog rows and flags any where the generated TITLE
 * names one product type but the DESCRIPTION talks about a different one
 * (e.g. dress title -> bag description). Confirms the failure before we fix.
 */
import { readFileSync } from "fs";

function prodUrl(): string {
  const raw = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
  if (!m) throw new Error("no DATABASE_URL");
  let url = m[1];
  if (url.includes("meta7media_office_dev")) throw new Error("refusing DEV db");
  url = url.includes("connection_limit=") ? url.replace(/connection_limit=\d+/, "connection_limit=1") : url + (url.includes("?") ? "&" : "?") + "connection_limit=1";
  return url;
}

// product-type buckets — if the title is clearly in one bucket and the
// description leans on a DIFFERENT bucket's noun, that's the bug.
const BUCKETS: Record<string, string[]> = {
  dress: ["dress", "gown"],
  bag: ["bag", "tote", "purse", "backpack", "clutch", "crossbody"],
  jacket: ["jacket", "coat", "blazer", "bomber"],
  top: ["top", "blouse", "shirt", "tee", "sweater", "hoodie", "cardigan"],
  bottom: ["pants", "trousers", "leggings", "jeans", "skirt", "shorts"],
  shoes: ["shoes", "boots", "heels", "sneakers", "sandals"],
  jewelry: ["necklace", "earring", "ring", "bracelet", "pendant"],
  home: ["mug", "candle", "blanket", "pillow", "vase", "lamp"],
};
function bucketsIn(text: string): Set<string> {
  const t = (text || "").toLowerCase();
  const s = new Set<string>();
  for (const [b, words] of Object.entries(BUCKETS)) if (words.some((w) => new RegExp(`\\b${w}s?\\b`).test(t))) s.add(b);
  return s;
}

async function main() {
  process.env.DATABASE_URL = prodUrl();
  const { prisma } = await import("../../src/lib/prisma");
  const rows = await prisma.seoAutopilotLog.findMany({
    where: { verdict: { in: ["ALLOWED", "REVIEW"] } },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { createdAt: true, generatedTitle: true, sourceTitle: true, listingJson: true },
  });
  console.log(`Scanned ${rows.length} recent generations.\n`);
  let mismatches = 0;
  for (const r of rows) {
    const listing = r.listingJson as any;
    const desc: string = listing?.description || "";
    if (!desc) continue;
    const titleB = bucketsIn(r.generatedTitle || "");
    // dominant bucket in the description = the bucket whose words appear most
    const descB = bucketsIn(desc);
    // mismatch: title clearly one apparel/product bucket, description introduces a DIFFERENT product bucket the title doesn't have
    const extra = [...descB].filter((b) => !titleB.has(b));
    const titleHasProduct = titleB.size > 0;
    if (titleHasProduct && extra.length > 0) {
      // only flag if the extra bucket actually appears prominently (>=2 hits) — avoid 1-off mentions
      const strongExtra = extra.filter((b) => {
        const hits = BUCKETS[b].reduce((n, w) => n + (desc.toLowerCase().match(new RegExp(`\\b${w}s?\\b`, "g"))?.length || 0), 0);
        return hits >= 2;
      });
      if (strongExtra.length) {
        mismatches++;
        console.log(`⚠️  MISMATCH (${r.createdAt.toISOString().slice(0,10)})`);
        console.log(`   title:  ${r.generatedTitle}   [${[...titleB].join(",")}]`);
        console.log(`   desc introduces: [${strongExtra.join(",")}]`);
        console.log(`   desc 1st line: ${desc.split(/\\n|\n/)[0].slice(0,140)}`);
        console.log("");
      }
    }
  }
  console.log(mismatches ? `\nFound ${mismatches} likely wrong-product description(s).` : "\nNo clear title/description product mismatches in the last 80 gens.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
