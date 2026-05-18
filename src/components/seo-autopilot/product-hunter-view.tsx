"use client";

import { useState, useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { ManualHuntingSection } from "./manual-hunting-section";
import { HUNT_COMPLETE_EVENT } from "./product-hunter-hero";

// ─── Recent hunts storage (localStorage) ─────────────────────────────
//
// Each successful Manual Hunting run is appended to a per-user list in
// localStorage so the hub can show a Recent Hunts strip at the bottom.
// Clicking a card pre-fills the niche input so the seller can re-run
// (or tweak) without retyping. Cap at 12 entries, LRU-style.

export interface RecentHunt {
  niche: string;
  style: string | null;
  audience: string | null;
  timestamp: number;
  categoryCount?: number;
  productCount?: number;
}

const RECENT_HUNTS_KEY = "productHunter.recentHunts.v1";
const RECENT_HUNTS_MAX = 12;

function readRecentHunts(): RecentHunt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_HUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, RECENT_HUNTS_MAX);
  } catch {
    return [];
  }
}

export function saveRecentHunt(hunt: RecentHunt) {
  if (typeof window === "undefined") return;
  try {
    const existing = readRecentHunts();
    // Dedupe by niche+style+audience signature (same query = bump to top)
    const sig = `${hunt.niche.toLowerCase()}|${hunt.style ?? ""}|${hunt.audience ?? ""}`;
    const filtered = existing.filter(
      (h) =>
        `${h.niche.toLowerCase()}|${h.style ?? ""}|${h.audience ?? ""}` !==
        sig,
    );
    const next = [hunt, ...filtered].slice(0, RECENT_HUNTS_MAX);
    window.localStorage.setItem(RECENT_HUNTS_KEY, JSON.stringify(next));
    // Notify any listening components via a custom event
    window.dispatchEvent(new CustomEvent("productHunter:recentHuntsChanged"));
  } catch {
    /* ignore */
  }
}

/**
 * React hook — returns the live recent-hunts list and re-renders
 * whenever saveRecentHunt() fires (same-tab) or another tab updates
 * localStorage (cross-tab). Lazy initializer avoids the "no setState
 * in useEffect" rule; subscriptions only call setHunts from event
 * callbacks (which is allowed).
 *
 * Used by ManualHuntingSection to show the user's last hunts inline
 * inside the niche input card.
 */
export function useRecentHunts(): RecentHunt[] {
  const [hunts, setHunts] = useState<RecentHunt[]>(() => readRecentHunts());

  useEffect(() => {
    const onChange = () => setHunts(readRecentHunts());
    window.addEventListener("productHunter:recentHuntsChanged", onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECENT_HUNTS_KEY) setHunts(readRecentHunts());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(
        "productHunter:recentHuntsChanged",
        onChange,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return hunts;
}

// ─── Main view ──────────────────────────────────────────────────────

/**
 * Product Hunter view — content only. The page-level wrapper handles
 * the full-bleed hero + max-w-5xl content column shell (matches the
 * Price Calculator + Product Validator pattern). This component just
 * renders the feedback notice + the ManualHuntingSection workhorse.
 *
 * Launched to the full Etsy team May 18 2026 (CEO + Izaan + EM + AE +
 * ME + Etsy partners). HR / Facebook / Zain see a Coming Soon
 * placeholder upstream in the page guard.
 */
export function ProductHunterView({
  userRole,
}: {
  /** Role flag — only used to derive isCeo for the cost-footer gate
   * on ManualHuntingSection's result hero. AE pill / quota chip are
   * handled by ProductHunterHero (rendered separately by the page). */
  userRole: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const isCeo = userRole === "SUPER_ADMIN";

  // ManualHuntingSection calls onHuntComplete after each successful
  // hunt. We dispatch a window event the hero listens for — keeps the
  // hero quota chip in sync without needing to plumb state up.
  const handleHuntComplete = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(HUNT_COMPLETE_EVENT));
  };

  return (
    <div className="space-y-6">
      <FeedbackNotice />
      <ManualHuntingSection isCeo={isCeo} onHuntComplete={handleHuntComplete} />
    </div>
  );
}

// ─── Feedback notice ────────────────────────────────────────────────

function FeedbackNotice() {
  return (
    <div className="rounded-xl bg-gradient-to-r from-sky-500/12 via-violet-500/8 to-emerald-500/12 ring-1 ring-sky-500/30 px-4 py-3 flex items-start gap-3">
      <div className="size-9 rounded-lg bg-sky-500/20 ring-1 ring-sky-500/40 flex items-center justify-center shrink-0">
        <MessageCircle className="size-4 text-sky-700 dark:text-sky-400" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[12px] font-bold text-sky-900 dark:text-sky-200 leading-tight">
          Tip: share what you find — and what&apos;s missing
        </p>
        <p className="text-[11px] text-sky-800/85 dark:text-sky-200/80 leading-relaxed">
          If a niche returns no results, scoring feels off, or a
          category is missing from one of your products — tell the CEO
          so the rules can be tuned. The more feedback the team gives,
          the sharper the picks get.
        </p>
      </div>
    </div>
  );
}
