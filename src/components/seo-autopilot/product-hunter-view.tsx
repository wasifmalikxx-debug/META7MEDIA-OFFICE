"use client";

import { useState, useEffect } from "react";
import {
  Sparkles,
  Check,
  TrendingUp,
  Target,
  Heart,
  Plug,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ManualHuntingSection } from "./manual-hunting-section";

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

// formatTimeAgo() lived here for the deleted RecentHuntsStrip card.
// Removed — the inline chips don't show timestamps (would make them
// too long). Resurrect from git history if/when needed again.

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
 * Product Hunter is a single-pane tool: type a seed, get underserved
 * Etsy keywords scored by demand + engagement + shop diversity.
 *
 * History (deleted features, kept here for context):
 *   - Reverse Hunt   (May 17 2026): paste AE URL → verdict. CEO removed.
 *   - Image Hunt     (May 17 2026): paste image → AE matches. AE
 *                    image search endpoint never worked across 5
 *                    request formats. CEO removed.
 *   - Daily Trending (May 18 2026): morning AE feed scoped to niche
 *                    book. Tabs + service + cron removed entirely.
 *   - "More Soon"    (May 18 2026): roadmap card placeholder. Removed.
 *
 * Product Hunter is now ONE tool, no tabs.
 */
export function ProductHunterView({
  userRole = "SUPER_ADMIN",
}: {
  /** Role gate for the AE connection banner. CEO sees full controls,
   * partners see status-only (no Connect button), everyone else gets
   * the banner hidden entirely. Defaults to SUPER_ADMIN for backward
   * compat with calls that don't pass the prop yet. */
  userRole?: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const isCeo = userRole === "SUPER_ADMIN";

  return (
    <div className="relative pb-12">
      {/* Full-bleed hero: cancels the <main> p-4 md:p-6 + own top
          padding so it spans edge to edge under the dashboard header.
          AE status pill lives INSIDE the hero (next to Hunting hub
          label) — no separate banner below. */}
      <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
        <HeroBanner userRole={userRole} />
      </div>

      {/* Constrained content column. ManualHuntingSection gets isCeo
          so it can hide the Claude API "Cost: $X.XXXX" footer in the
          result hero (CEO-only) — AE product prices stay visible to
          everyone. */}
      <div className="max-w-5xl mx-auto space-y-6">
        <ManualHuntingSection isCeo={isCeo} />
      </div>
    </div>
  );
}

// ─── Hero banner ────────────────────────────────────────────────────
//
// Dark gradient hero with animated aurora blobs — matches the SEO
// Autopilot hero structurally but uses a COOL (navy → violet → cyan)
// palette to differentiate Product Hunter from the WARM (purple →
// orange) palette of SEO Autopilot.
//
// Static stat cells now that Product Hunter is a single-tool view
// (no more tab-aware copy switching).

const HERO_CELLS: Array<{
  icon: typeof Sparkles;
  label: string;
  sub: string;
}> = [
  { icon: Sparkles, label: "25 variants", sub: "Claude brainstorm" },
  { icon: TrendingUp, label: "Live Etsy", sub: "Demand · favorites · shops" },
  { icon: Heart, label: "Ranked", sub: "GREAT · GOOD · MAYBE · SKIP" },
];

function HeroBanner({
  userRole,
}: {
  userRole: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  return (
    <div className="relative overflow-hidden shadow-xl shadow-violet-500/15 ap-stagger-in border-b border-white/10">
      {/* Base gradient — cool navy → violet → navy to differentiate
          Product Hunter from SEO Autopilot's warm purple → orange.
          Full-bleed (no rounded corners, no side ring) so it spans
          edge-to-edge under the dashboard header. */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d1a2a] via-[#1a1226] to-[#0d1a2a]" />

      {/* Animated aurora blobs — cyan + violet */}
      <div
        aria-hidden
        className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl ap-aurora-1"
        style={{
          background:
            "radial-gradient(closest-side, rgba(34,211,238,0.55), rgba(34,211,238,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(168,85,247,0.55), rgba(168,85,247,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />

      {/* Inner content is still constrained to max-w-5xl so headlines
          don't sprawl across ultrawide displays — only the visual
          background is full-width. */}
      <div className="relative max-w-5xl mx-auto px-7 sm:px-9 py-8 sm:py-10">
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 shadow-inner">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            CEO admin · Beta
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <Sparkles className="size-3" />
            Hunting hub
          </span>
          {/* AE status pill — sits right next to "Hunting hub" in the
              header row. Role-aware (see component). */}
          <AliExpressHeaderPill userRole={userRole} />
        </div>

        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-sky-400/40 to-violet-500/40 blur-lg ap-orb-pulse"
            />
            <div className="relative size-16 sm:size-[68px] rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-sky-900/40">
              <Target className="size-7 sm:size-8 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
              Product Hunter
            </h1>
            {/* Description used to live here; moved out of the hero so
                it reads as a standalone intro paragraph below the
                banner (CEO ask May 16 2026). See <HeroDescription>. */}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          {HERO_CELLS.map((cell) => (
            <FeatureCell
              key={cell.label}
              icon={cell.icon}
              label={cell.label}
              sub={cell.sub}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureCell({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="size-8 rounded-lg bg-white/10 ring-1 ring-white/15 flex items-center justify-center shrink-0">
        <Icon className="size-4 text-white/90" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] sm:text-[12px] font-semibold text-white leading-tight truncate">
          {label}
        </p>
        <p className="text-[10px] text-white/55 leading-tight truncate">{sub}</p>
      </div>
    </div>
  );
}

// ─── AliExpress connection banner ───────────────────────────────────

interface AliConnectionStatus {
  connected: boolean;
  expired?: boolean;
  aliUserNick?: string | null;
  aliUserId?: string | null;
  expiresAt?: string;
  connectedAt?: string;
}

// ─── AE connection pill (lives inside the hero) ─────────────────────
//
// CEO asked May 16 2026 to "shift the AliExpress button into the
// header, right side of Product Hunter (or next to the Hunting hub
// label)". This is the compact pill version that sits in the hero's
// status-pill row, replacing the old below-the-hero card.
//
// Role behaviour (unchanged):
//   - SUPER_ADMIN (CEO): connected → green pill with × disconnect;
//                        disconnected → orange Connect link
//   - PARTNER: connected → green status-only pill;
//              disconnected → orange "ask Wasif" info pill
//   - everyone else: nothing (the tool just works via CEO's token)
function AliExpressHeaderPill({
  userRole = "SUPER_ADMIN",
}: {
  userRole?: "SUPER_ADMIN" | "PARTNER" | "MANAGER" | "EMPLOYEE" | "HR_ADMIN";
}) {
  const [status, setStatus] = useState<AliConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // IMPORTANT: hooks MUST be called unconditionally — the role gate
  // happens AFTER all hooks (early return below).
  useEffect(() => {
    let cancelled = false;

    // Read ?aliConnect=success / denied / state_mismatch from URL on
    // first mount and show a toast — then strip the query param so
    // refreshes don't re-fire it.
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("aliConnect");
    if (flag) {
      const reason = url.searchParams.get("reason");
      if (flag === "success") {
        toast.success("AliExpress connected", {
          description: "Full-loop product hunting is now active.",
        });
      } else if (flag === "denied") {
        toast.error("AliExpress authorization cancelled");
      } else {
        toast.error("AliExpress connection failed", {
          description: reason ?? flag,
        });
      }
      url.searchParams.delete("aliConnect");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.toString());
    }

    async function load() {
      try {
        const res = await fetch("/api/aliexpress/status");
        if (!res.ok) return;
        const data = (await res.json()) as AliConnectionStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // ignore — banner just won't render
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Role gating happens AFTER hooks. Only CEO + Partner ever see the
  // banner. Everyone else gets nothing — the tool just works for them
  // because Manual Hunting borrows the CEO's stored AE token server-side.
  const isCeo = userRole === "SUPER_ADMIN";
  const isPartner = userRole === "PARTNER";
  if (!isCeo && !isPartner) return null;

  if (loading) return null;

  // DISCONNECTED — orange pill. CEO gets a clickable Connect link;
  // partner gets an info-only "ask Wasif" pill.
  if (!status || !status.connected) {
    if (isCeo) {
      return (
        <a
          href="/api/aliexpress/auth-start"
          className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.16em] uppercase bg-gradient-to-r from-orange-500/85 to-rose-600/85 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-orange-300/40 shadow-md shadow-orange-500/25 hover:from-orange-500 hover:to-rose-600 transition-colors"
          title="Connect your AliExpress account"
        >
          <Plug className="size-3" />
          Connect AliExpress
        </a>
      );
    }
    // Partner — info pill, no action
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-bold text-orange-100 tracking-[0.16em] uppercase bg-orange-500/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-orange-300/30"
        title="AliExpress not connected — only the CEO can attach an account"
      >
        <Plug className="size-3" />
        AE off · ask the CEO
      </span>
    );
  }

  // CONNECTED — green status pill. CEO sees a tiny × to disconnect;
  // partners see status only.
  const disconnect = async () => {
    if (!confirm("Disconnect AliExpress? You'll need to re-authorize."))
      return;
    await fetch("/api/aliexpress/disconnect", { method: "POST" });
    setStatus({ connected: false });
    toast.success("Disconnected from AliExpress");
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-100 tracking-[0.16em] uppercase bg-emerald-500/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-emerald-300/30">
      <Check className="size-3 text-emerald-300" strokeWidth={3} />
      AliExpress connected
      {isCeo && (
        <button
          type="button"
          onClick={disconnect}
          className="ml-0.5 size-3.5 rounded-full hover:bg-white/15 inline-flex items-center justify-center transition-colors -mr-1"
          title="Disconnect AliExpress"
          aria-label="Disconnect AliExpress"
        >
          <X className="size-2.5" strokeWidth={3} />
        </button>
      )}
    </span>
  );
}

// Recent-hunts UI used to live here as a standalone strip at the
// bottom of the page. Consolidated into the NicheInputCard (May 16
// 2026 v3) — see `useRecentHunts()` above + ManualHuntingSection's
// inline chip row. Strip + card components deleted.
