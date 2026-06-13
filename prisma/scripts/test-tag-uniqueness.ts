/**
 * Adversarial unit test for the tag-uniqueness engine.
 * Run: npx tsx prisma/scripts/test-tag-uniqueness.ts
 * Proves the "EXACTLY 13 unique tags, no exact/near dupes" guarantee.
 * NODE_ENV is non-production here, so the engine's internal invariant
 * THROWS on any near-dup leak — a bug fails loudly.
 */
import {
  enforceTagUniqueness,
  tagCanonical,
} from "../../src/lib/services/anthropic.service";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${label} ${detail}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function audit(
  name: string,
  primary: string[],
  reserve: string[],
  expectFull: boolean,
) {
  console.log(`\n[${name}]`);
  let r;
  try {
    r = enforceTagUniqueness(primary, reserve);
  } catch (e) {
    // The engine's dev-only invariant throws on any exact/near/substring
    // dup leak — surface it as a clean check failure instead of a crash.
    check("engine invariant (no dup leak)", false, String(e));
    return;
  }
  // 1. no exact duplicates
  check("no exact dupes", new Set(r.tags).size === r.tags.length, JSON.stringify(r.tags));
  // 2. no canonical (near/plural) duplicates
  const canon = r.tags.map(tagCanonical);
  check("no near/plural dupes", new Set(canon).size === canon.length, JSON.stringify(canon));
  // 3. length + charset rules
  check("all 3..20 chars", r.tags.every((t) => t.length >= 3 && t.length <= 20));
  check("all lowercase + clean charset", r.tags.every((t) => /^[a-z0-9 -]+$/.test(t)));
  // 4. count contract
  if (expectFull) {
    check("exactly 13", r.tags.length === 13, `got ${r.tags.length} short=${r.short}`);
  } else {
    check("<=13 and short flag set", r.tags.length <= 13 && r.short === (r.tags.length < 13));
  }
}

// 1. All-same-noun restatements — the classic "half the tags are dupes" case.
audit(
  "all-same-noun (mermaid x many)",
  [
    "mermaid prom dress", "mermaid prom gown", "mermaid evening gown",
    "mermaid dress", "mermaid gown", "mermaid formal dress",
    "mermaid ball gown", "mermaid party dress",
  ],
  [
    "lilac prom dress", "lace bodice gown", "sweetheart neckline",
    "strapless formal", "satin evening gown", "quinceanera dress",
    "pageant gown", "floor length dress", "cape sleeve gown",
    "embellished gown", "ivory formal dress",
  ],
  true,
);

// 2. Singular / plural pairs everywhere — must collapse to one each.
audit(
  "singular/plural pairs",
  [
    "prom dress", "prom dresses", "gold ring", "gold rings",
    "silk scarf", "silk scarves", "party box", "party boxes",
    "baby shoe", "baby shoes", "wedding gift", "wedding gifts",
    "leaf earring", "leaf earrings",
  ],
  [
    "rose gold band", "minimalist ring", "boho scarf", "satin gown",
    "gift for mom", "stacking ring set", "winter wrap",
  ],
  true,
);

// 3. Exact duplicate flood (simulates the parallel-swap collision input).
audit(
  "exact-dup flood",
  [
    "leather crossbody", "leather crossbody", "leather crossbody",
    "vegan tote", "vegan tote", "work bag", "work bag",
  ],
  [
    "laptop bag", "travel purse", "shoulder bag", "rfid wallet",
    "anti theft bag", "small handbag", "everyday tote", "canvas bag",
    "commuter bag", "zip pouch", "card holder",
  ],
  true,
);

// 4. Over-supply (20 distinct) — must clamp to exactly 13.
audit(
  "over-supply 20 distinct",
  [
    "a1 alpha", "b2 beta", "c3 gamma", "d4 delta", "e5 epsilon",
    "f6 zeta", "g7 eta", "h8 theta", "i9 iota", "j1 kappa",
    "k2 lamb", "l3 mu", "m4 nu", "n5 xi", "o6 omicron",
    "p7 pi", "q8 rho", "r9 sigma", "s1 tau", "t2 upsilon",
  ],
  [],
  true,
);

// 5. Genuinely short (fewer than 13 distinct, no reserve) — short:true, NO dupes.
audit("genuinely short", ["ring", "ring", "ring", "gold ring"], [], false);

// 6. Junk + MTO + over-length — must clean/drop without crashing.
audit(
  "junk + mto + overlength",
  [
    "  Prom Dress!!!  ", "prom-dress", "ab", "",
    "personalized mug", "monogrammed tote",
    "this is a really long tag over twenty chars",
    "VALID Tag One", "valid tag two", "valid tag three",
    "valid tag four", "valid tag five", "valid tag six",
    "valid tag seven", "valid tag eight",
  ],
  [
    "boho wall art", "ceramic flower vase", "linen throw pillow",
    "brass candlestick", "woven seagrass basket", "macrame plant hanger",
    "stoneware coffee mug", "cotton table runner",
  ],
  true,
);

// 7. Empty input — must not crash, short:true, zero tags.
audit("empty input", [], [], false);

// 8. Aesthetic single-words must survive (no significant stems).
audit(
  "aesthetic single words",
  [
    "y2k", "boho", "cottagecore", "grunge", "kawaii", "preppy",
    "gothic", "minimalist", "coquette", "fairycore", "indie",
    "vintage", "retro",
  ],
  [],
  true,
);

// 9. Substring near-dup repro (the review finding): a cap-deferred
// "gold ring" must NOT ship next to reserve "band gold ring". The engine
// should drop one (and go short -> tags-regen in prod) rather than leak it.
{
  console.log("\n[substring near-dup repro (cap-relax path)]");
  const r = enforceTagUniqueness(
    [
      "silver ring", "rose ring", "pearl ring", "gold ring", "blue topaz",
      "green amethyst", "red garnet", "white opal", "black onyx",
      "pink quartz", "clear crystal", "yellow citrine",
    ],
    ["band gold ring"],
  );
  const hasGold = r.tags.includes("gold ring");
  const hasBand = r.tags.includes("band gold ring");
  check("not both 'gold ring' & 'band gold ring'", !(hasGold && hasBand), JSON.stringify(r.tags));
  check("no exact dupes", new Set(r.tags).size === r.tags.length);
  const canon = r.tags.map(tagCanonical);
  check("no near/plural dupes", new Set(canon).size === canon.length);
  check("short flag consistent", r.short === (r.tags.length < 13), `len=${r.tags.length} short=${r.short}`);
}

console.log(
  failures === 0
    ? "\n✅ ALL TAG-UNIQUENESS TESTS PASSED"
    : `\n❌ ${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
