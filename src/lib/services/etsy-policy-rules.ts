/**
 * Etsy policy rule set for the Product Validator.
 *
 * Encoded from screenshots the CEO shared on May 17 2026:
 *   1. Prohibited Items Policy (8 categories)
 *   2. Lifesaving & PPE Policy (effective July 2025)
 *   3. Creativity Standards (4 buckets: Made / Designed / Handpicked / Sourced)
 *
 * Tone: "balanced advisor" — only flag what's likely to actually get
 * removed from Etsy. Don't drown the seller in warnings about every
 * mass-produced item; focus on the patterns Etsy's enforcement actually
 * picks up on (brand counterfeits, prohibited categories, clear
 * commodity tells like bulk packs).
 *
 * Rule shape:
 *   - severity: "block" = clear policy violation → don't list
 *   - severity: "review" = caution required → reframe / customize / verify
 *   - matchType: "substring" (case-insensitive contains)
 *               | "regex" (case-insensitive)
 *   - policyClause = the citation that shows in the result panel so the
 *                    team learns Etsy's actual rule, not just "no list."
 *
 * Maintained by hand. When Etsy updates a policy, add/edit rules here.
 */

export type RuleSeverity = "block" | "review";
export type RuleMatchType = "substring" | "regex";

export interface PolicyRule {
  /** Stable ID for diagnostic / debugging. */
  id: string;
  /** Which Etsy policy this enforces. */
  policy:
    | "prohibited"
    | "ppe"
    | "ip"
    | "hate"
    | "adult"
    | "animals"
    | "drugs"
    | "weapons"
    | "violence"
    | "creativity";
  severity: RuleSeverity;
  matchType: RuleMatchType;
  /** Words / regex patterns to match against the lowercased title. */
  patterns: string[];
  /** Short label shown in the result UI. */
  label: string;
  /** The Etsy policy clause citation shown in the result UI. */
  policyClause: string;
  /** Plain-English explanation of why it's flagged. */
  explanation: string;
  /** Optional suggestion the team can try instead. */
  suggestion?: string;
}

// ─── BLOCK rules — clear policy violations ──────────────────────────

const WEAPON_RULES: PolicyRule[] = [
  {
    id: "weapons-firearms",
    policy: "weapons",
    severity: "block",
    matchType: "substring",
    patterns: [
      "firearm", "pistol", "rifle", "shotgun", "handgun", "revolver",
      "ammunition", " ammo ", "magazine clip",
      "gun barrel", "gun stock", "trigger assembly",
      // Note: "bullet" removed — false-positives on "bullet journal"
      // (legitimate huge Etsy category). "ammunition" + "ammo" cover
      // the real weapon angle.
    ],
    label: "Firearms / ammunition",
    policyClause: "Prohibited Items Policy § 3 — Dangerous Items",
    explanation:
      "Etsy bans firearms, firearm parts, and ammunition outright.",
    suggestion: "Skip this product. There is no compliant framing.",
  },
  {
    id: "weapons-bladed",
    policy: "weapons",
    severity: "block",
    matchType: "substring",
    patterns: [
      "tactical knife", "combat knife", "fighting knife", "switchblade",
      "butterfly knife", "balisong", "karambit",
      "sword", "katana", "machete", "bayonet", "dagger",
      "throwing knife", "throwing star", "shuriken",
    ],
    label: "Combat blades",
    policyClause: "Prohibited Items Policy § 3 — Dangerous Items",
    explanation:
      "Knives intended as weapons are banned. Kitchen knives and craft tools are usually fine.",
    suggestion:
      "If the product is a kitchen/craft knife, the title shouldn't include combat terminology.",
  },
  {
    id: "weapons-misc",
    policy: "weapons",
    severity: "block",
    matchType: "substring",
    patterns: [
      "brass knuckles", "knuckle duster", "taser", "stun gun",
      "pepper spray", "tear gas",
      "explosive", "firework", "gunpowder", " c4 ",
      "smoke bomb", "molotov",
    ],
    label: "Other dangerous weapons",
    policyClause: "Prohibited Items Policy § 3 — Dangerous Items",
    explanation:
      "Self-defense weapons, explosives, and incendiary devices are banned.",
    suggestion: "Skip this product.",
  },
];

const DRUG_RULES: PolicyRule[] = [
  {
    id: "drugs-paraphernalia",
    policy: "drugs",
    severity: "block",
    matchType: "substring",
    patterns: [
      "bong", "hookah", "shisha", "dab rig", "water pipe",
      "smoking pipe", "weed grinder", "rolling tray",
      "vape", "vaping", "e-cig", "e cig", "ecig", "vaporizer",
      "juul", "pod system",
    ],
    label: "Drug paraphernalia / vape",
    policyClause: "Prohibited Items Policy § 1 — Alcohol, Drugs & Paraphernalia",
    explanation:
      "Smoking devices, vapes, and drug paraphernalia are prohibited on Etsy.",
  },
  {
    id: "drugs-substance",
    policy: "drugs",
    severity: "block",
    matchType: "substring",
    patterns: [
      "marijuana", "cannabis", " thc ", " cbd ",
      "cbd oil", "thc oil", "delta-8", "delta 8", "delta-9",
      "psilocybin", "shroom",
      "cocaine", "heroin", "meth ",
      "prescription drug", "pharmaceutical",
    ],
    label: "Controlled substances",
    policyClause: "Prohibited Items Policy § 1 — Alcohol, Drugs & Paraphernalia",
    explanation:
      "Etsy prohibits controlled substances and pharmaceuticals (incl. CBD/THC in most regions).",
  },
  {
    id: "drugs-alcohol-product",
    policy: "drugs",
    severity: "review",
    matchType: "substring",
    patterns: [
      "whiskey bottle", "vodka bottle", "rum bottle",
      "liquor bottle", "beer bottle",
    ],
    label: "Alcohol product",
    policyClause: "Prohibited Items Policy § 1",
    explanation:
      "Selling actual alcohol is banned. Decorative empty bottles and barware can be fine — confirm before listing.",
  },
];

const HATE_RULES: PolicyRule[] = [
  {
    id: "hate-symbols",
    policy: "hate",
    severity: "block",
    matchType: "substring",
    patterns: [
      "nazi", "swastika", "ss insignia",
      "kkk", "ku klux klan", "klan ",
      "white power", "white pride", "white nationalist",
      "13/52", "1488", "blood and soil",
    ],
    label: "Hate symbols",
    policyClause: "Prohibited Items Policy § 4 — Hate Items",
    explanation:
      "Items promoting, supporting, or glorifying hatred are strictly prohibited.",
  },
  {
    id: "hate-confederate",
    policy: "hate",
    severity: "review",
    matchType: "substring",
    patterns: ["confederate flag", "stars and bars", "rebel flag"],
    label: "Confederate imagery",
    policyClause: "Prohibited Items Policy § 4 — Hate Items",
    explanation:
      "Confederate symbols are restricted on Etsy in most contexts. Museum / educational pieces have narrow exceptions.",
  },
];

const ADULT_RULES: PolicyRule[] = [
  {
    id: "adult-sextoys",
    policy: "adult",
    severity: "block",
    matchType: "substring",
    patterns: [
      "sex toy", "vibrator", "dildo", "masturbator",
      "pocket pussy", "fleshlight",
      "anal plug", "butt plug", "cock ring",
      "bdsm", "bondage gear",
    ],
    label: "Sexual aids",
    policyClause: "Prohibited Items Policy § 7 — Mature & Adult Content",
    explanation:
      "Sex toys and explicit sexual aids are banned on Etsy.",
  },
  {
    id: "adult-pornographic",
    policy: "adult",
    severity: "block",
    matchType: "substring",
    patterns: ["pornography", "porn ", "hardcore sex", "explicit nudity"],
    label: "Pornographic content",
    policyClause: "Prohibited Items Policy § 7 — Mature & Adult Content",
    explanation: "Pornographic items are prohibited.",
  },
];

const PPE_RULES: PolicyRule[] = [
  {
    id: "ppe-respiratory",
    policy: "ppe",
    severity: "block",
    matchType: "substring",
    patterns: [
      "n95", "n99", "kn95",
      "surgical mask", "medical mask", "medical-grade mask",
      "respirator", "p100 ", "p95",
      "gas mask", "chemical mask",
    ],
    label: "Respiratory protection",
    policyClause: "Lifesaving & PPE Policy — effective 21 Jul 2025",
    explanation:
      "Industrial respirators and medical-grade masks are prohibited. Cloth/fashion face masks are fine — see the difference.",
  },
  {
    id: "ppe-occupational",
    policy: "ppe",
    severity: "block",
    matchType: "substring",
    patterns: [
      "hard hat", "safety helmet",
      "safety goggles", "safety glasses occupational",
      "face shield occupational", "welding mask", "welding helmet",
      "hazmat suit", "lead-lined apron", "lead apron",
      "industrial earmuff", "ear protection industrial",
      "cut-resistant glove", "chainmail glove",
      "medical glove", "nitrile glove disposable",
      "steel toe boot", "steel-toe boot",
      "reflective vest", "hi-vis vest", "high visibility vest",
    ],
    label: "Industrial / occupational PPE",
    policyClause: "Lifesaving & PPE Policy — effective 21 Jul 2025",
    explanation:
      "PPE for workplace / industrial / medical use is banned. Personal hobby and decorative versions are fine.",
  },
  {
    id: "ppe-lifesaving",
    policy: "ppe",
    severity: "block",
    matchType: "substring",
    patterns: [
      "fire extinguisher", "smoke detector", "smoke alarm",
      "carbon monoxide detector", "radiation dosimeter", "geiger counter",
      "personal flotation device", "life jacket", "life vest",
      "scuba", "oxygen tank", "oxygen cylinder",
      "safety harness", "fall harness", "lifeline ",
    ],
    label: "Lifesaving equipment",
    policyClause: "Lifesaving & PPE Policy — effective 21 Jul 2025",
    explanation: "Equipment designed to save lives is banned on Etsy.",
  },
];

const ANIMAL_RULES: PolicyRule[] = [
  {
    id: "animals-ivory",
    policy: "animals",
    severity: "block",
    matchType: "substring",
    patterns: ["ivory", "elephant tusk", "mammoth ivory"],
    label: "Ivory",
    policyClause: "Prohibited Items Policy § 2 — Animal Products",
    explanation:
      "Ivory is banned (CITES regulated). Even antique ivory is restricted.",
  },
  {
    id: "animals-realfur",
    policy: "animals",
    severity: "review",
    matchType: "substring",
    patterns: [
      "real fur", "genuine fur", "mink fur", "fox fur",
      "rabbit fur", "chinchilla fur", "raccoon fur", "real mink",
    ],
    label: "Real fur",
    policyClause: "Prohibited Items Policy § 2 — Animal Products",
    explanation:
      "Real fur is restricted. Faux fur is allowed. Confirm the material before listing.",
  },
  {
    id: "animals-endangered",
    policy: "animals",
    severity: "block",
    matchType: "substring",
    patterns: [
      "rhino horn", "tiger bone", "bear bile", "shark fin",
      "endangered species", "cites prohibited",
    ],
    label: "Endangered species products",
    policyClause: "Prohibited Items Policy § 2 — Animal Products",
    explanation: "Products from endangered species are internationally banned.",
  },
];

const IP_RULES: PolicyRule[] = [
  {
    id: "ip-tech-brands",
    policy: "ip",
    severity: "block",
    matchType: "substring",
    patterns: [
      "apple iphone", "apple watch", "macbook", "airpods",
      "samsung galaxy", "samsung s2", "samsung note",
      "sony playstation", "playstation ", "ps5 ", "ps4 ",
      "nintendo switch", "nintendo ds", "xbox ",
      "google pixel", "amazon echo", "amazon alexa",
    ],
    label: "Tech brand counterfeit",
    policyClause: "Prohibited Items Policy § 5 — IP Infringement",
    explanation:
      "Listing items with tech brand names is almost always a counterfeit risk and gets removed fast.",
    suggestion:
      "If it's a generic accessory (e.g. phone case), drop the brand name from the title.",
  },
  {
    id: "ip-fashion-brands",
    policy: "ip",
    severity: "block",
    matchType: "substring",
    patterns: [
      "nike ", "adidas", "puma ", "reebok", "champion brand",
      "under armour", "lululemon",
      "louis vuitton", "gucci", "chanel", "hermes", "prada",
      "versace", "balenciaga", "dior", "fendi", "burberry",
      "rolex", "cartier", "omega watch", "tag heuer",
      "ralph lauren", "tommy hilfiger", "calvin klein",
      "zara ", " h&m ", "uniqlo brand",
    ],
    label: "Fashion brand counterfeit",
    policyClause: "Prohibited Items Policy § 5 — IP Infringement",
    explanation: "Fashion brand names = likely counterfeit. Etsy removes these quickly.",
    suggestion: "Reframe as generic / unbranded. Remove brand names from the title.",
  },
  {
    id: "ip-characters",
    policy: "ip",
    severity: "block",
    matchType: "substring",
    patterns: [
      // Studios & franchises (catches generic-named products)
      "disney", "pixar", "marvel", "dc comics",
      "star wars", "harry potter", "lord of the rings", "lotr ",

      // Disney / Pixar characters
      "mickey mouse", "minnie mouse", "donald duck", "goofy",
      "frozen elsa", "moana", "lion king",

      // Marvel characters (added May 18 — Deadpool / Wolverine / X-Men
      // were missed by the original list, causing a false-SAFE on a
      // Deadpool costume listing)
      "batman", "superman", "spider-man", "spiderman", "spider man",
      "iron man", "ironman", "captain america",
      "wonder woman", "wonderwoman",
      "deadpool", "dead pool", "wolverine", "x-men", "x men",
      "black panther", "doctor strange", "ant-man", "antman",
      "venom symbiote", "groot ", "rocket raccoon",
      "loki marvel", "scarlet witch", "doctor doom",
      // Note: "thor", "hulk", "joker" still excluded — false-positives
      // on "thoroughly", "hulking", playing-card "joker". The broader
      // "marvel" + "dc comics" patterns catch products that name them.

      // DC characters
      "harley quinn", "harleyquinn", "the flash dc", "aquaman",
      "green lantern", "robin batman", "catwoman dc",

      // Anime / video game / cartoon IPs
      "pokemon", "pikachu", "naruto", "dragon ball", " goku ",
      "sonic the hedgehog", "super mario", "mario bros",
      "minecraft", "fortnite",
      "barbie", "lego",
      "hello kitty", "sanrio",
      "studio ghibli", "totoro",
      "one piece luffy", "demon slayer", "tanjiro",
      "attack on titan", "my hero academia",
    ],
    label: "Copyrighted characters",
    policyClause: "Prohibited Items Policy § 5 — IP Infringement",
    explanation:
      "Copyrighted characters get flagged by Etsy's automated IP scans within hours.",
    suggestion:
      "Use a generic theme (cute cartoon, anime-inspired, etc.) instead of named characters.",
  },
  {
    id: "ip-replica",
    policy: "ip",
    severity: "block",
    matchType: "substring",
    patterns: [
      "replica ", "1:1 replica", "1:1 copy", "high copy",
      "aaa replica", "designer replica", "luxury replica",
      "mirror copy", "knockoff",
    ],
    label: "Explicit replica / counterfeit indicators",
    policyClause: "Prohibited Items Policy § 5 — IP Infringement",
    explanation:
      "Titles that openly call themselves replicas / copies get auto-removed.",
  },
];

const VIOLENCE_RULES: PolicyRule[] = [
  {
    id: "violence-terrorism",
    policy: "violence",
    severity: "block",
    matchType: "substring",
    patterns: ["isis", "al-qaeda", "al qaeda", "taliban", "terrorist support"],
    label: "Terrorism / extremist support",
    policyClause: "Prohibited Items Policy § 8 — Violent Items",
    explanation: "Items supporting terrorism or extremist groups are banned.",
  },
  {
    id: "violence-selfharm",
    policy: "violence",
    severity: "block",
    matchType: "substring",
    patterns: [
      "pro-ana", "thinspiration", "thinspo",
      "self harm encourage", "suicide kit",
    ],
    label: "Self-harm / eating disorder content",
    policyClause: "Prohibited Items Policy § 8 — Violent Items",
    explanation: "Items encouraging self-harm or eating disorders are banned.",
  },
];

// ─── REVIEW rules — caution / reframing needed ──────────────────────

const CREATIVITY_RULES: PolicyRule[] = [
  {
    id: "creativity-bulk-pack",
    policy: "creativity",
    severity: "review",
    matchType: "regex",
    patterns: [
      // 1pc, 15 PC, 100PCS, 5 pieces, etc.
      "\\b\\d+\\s?pcs?\\b",
      "\\b\\d+\\s?pieces?\\b",
    ],
    label: "Bulk pack",
    policyClause: "Creativity Standards — Made by a Seller",
    explanation:
      "Bulk-pack titles signal mass-produced commodity. Etsy buyers + reviewers expect handmade or curated single items.",
    suggestion:
      "List one piece per listing and reframe (e.g. \"set of 3 bohemian rings\" → not \"50pc ring set\").",
  },
  {
    id: "creativity-wholesale",
    policy: "creativity",
    severity: "review",
    matchType: "substring",
    patterns: [
      "wholesale", "bulk supply", "factory direct",
      " oem ", " b2b ",
      "random color", "random pack", "random set",
      "in stock available",
    ],
    label: "Wholesale / commodity tells",
    policyClause: "Creativity Standards — Made by a Seller",
    explanation:
      "Wholesale/factory language signals a mass-produced reseller item, not handmade or designed.",
    suggestion:
      "Remove wholesale wording from the title. Frame as an artisan or curated item.",
  },
  {
    id: "creativity-generic-tech",
    policy: "creativity",
    severity: "review",
    matchType: "substring",
    patterns: [
      "usb cable", "usb charger", "hdmi cable", "ethernet cable",
      "wireless charger", "bluetooth speaker", "bluetooth earphone",
      "wireless earbuds", "power bank",
      "fast charger", "car charger",
    ],
    label: "Generic tech accessory",
    policyClause: "Creativity Standards — Made by a Seller",
    explanation:
      "Plain tech accessories don't fit Etsy's artisan/handmade buyer base. Likely to underperform and risk Creativity Standards removal.",
    suggestion:
      "If the item has a unique design / decoration / customization, lead with that in the title.",
  },
  {
    id: "creativity-knockoff-language",
    policy: "creativity",
    severity: "review",
    matchType: "substring",
    patterns: [
      "inspired by ", "look alike", "lookalike",
      "similar to brand", "compatible with brand",
    ],
    label: "Brand-adjacent wording",
    policyClause: "Prohibited Items Policy § 5 — IP Infringement",
    explanation:
      "\"Inspired by\" + a brand name is a yellow flag for IP review. Etsy may still remove it depending on the brand.",
    suggestion:
      "Strip brand references entirely; describe the style/aesthetic instead.",
  },
];

/** All rules combined. Order matters for diagnostic clarity (BLOCK rules first). */
export const ETSY_POLICY_RULES: ReadonlyArray<PolicyRule> = [
  ...WEAPON_RULES,
  ...DRUG_RULES,
  ...HATE_RULES,
  ...ADULT_RULES,
  ...PPE_RULES,
  ...ANIMAL_RULES,
  ...IP_RULES,
  ...VIOLENCE_RULES,
  ...CREATIVITY_RULES,
];

/**
 * Check a product title against all rules. Returns every rule that
 * matched, with the actual matched substring for transparency.
 *
 * Case-insensitive throughout. Substring matches anywhere in the title.
 * Regex matches use the global ignore-case flag.
 */
export interface RuleHit {
  rule: PolicyRule;
  /** The actual substring that triggered the match (for UI display). */
  matchedText: string;
}

export function evaluatePolicyRules(title: string): RuleHit[] {
  if (!title) return [];
  const lower = title.toLowerCase();
  const hits: RuleHit[] = [];
  const seenRuleIds = new Set<string>();

  for (const rule of ETSY_POLICY_RULES) {
    // Skip if we've already hit this rule (avoid duplicate matches
    // when multiple patterns in the same rule trigger).
    if (seenRuleIds.has(rule.id)) continue;

    for (const pattern of rule.patterns) {
      let matched: string | null = null;
      if (rule.matchType === "regex") {
        // Wrap with try/catch — a hand-edited bad regex would
        // otherwise crash the whole validation request. We log the
        // failure and skip the pattern so the rest of the rules
        // still run.
        try {
          const re = new RegExp(pattern, "i");
          const m = title.match(re);
          if (m) matched = m[0];
        } catch (err) {
          console.warn(
            `[etsy-policy-rules] invalid regex in rule ${rule.id}: "${pattern}"`,
            err instanceof Error ? err.message : err,
          );
          continue;
        }
      } else {
        if (lower.includes(pattern.toLowerCase())) {
          matched = pattern.trim();
        }
      }
      if (matched) {
        hits.push({ rule, matchedText: matched });
        seenRuleIds.add(rule.id);
        break;
      }
    }
  }

  return hits;
}

/**
 * Roll a list of rule hits into an overall verdict.
 *   BLOCKED — any block-severity rule fired
 *   REVIEW  — only review-severity rules fired
 *   SAFE    — nothing fired
 */
export type ValidationVerdict = "BLOCKED" | "REVIEW" | "SAFE";

export function rollupVerdict(hits: RuleHit[]): ValidationVerdict {
  if (hits.some((h) => h.rule.severity === "block")) return "BLOCKED";
  if (hits.some((h) => h.rule.severity === "review")) return "REVIEW";
  return "SAFE";
}
