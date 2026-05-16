"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Flame,
  Settings2,
  RefreshCw,
  Loader2,
  Sparkles,
  Bookmark,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingCard, type TrendingCardData } from "./trending-card";
import { NicheManagerModal } from "./niche-manager-modal";

/**
 * Daily Trending hub — full page view.
 *
 * Layout (top → bottom):
 *   1. Full-bleed hero (orange/rose — viral/fire theme to differentiate
 *      from Product Hunter's cool palette and Calculator's emerald)
 *   2. Niche chip row + "Manage" button
 *   3. Per-niche groups, each with a 2-3-4 col grid of TrendingCards
 *   4. CEO-only "Refresh now" pill in the hero (manual cron trigger)
 *
 * Data flow:
 *   • Initial fetch on mount via /api/daily-trending
 *   • Modal close re-fetches niches + feed
 *   • Claim/unclaim hits /api/daily-trending/[id]/claim and patches
 *     the local state so the badge flips without a full re-fetch
 */

interface NicheGroup {
  niche: string;
  products: TrendingCardData[];
}

interface FeedResponse {
  fetchDate: string;
  niches: Array<{
    id: string;
    niche: string;
    active: boolean;
    createdAt: string;
  }>;
  groups: NicheGroup[];
  isCeo: boolean;
}

export function DailyTrendingView({
  currentUserId,
  isCeo,
  embedded = false,
}: {
  currentUserId: string;
  isCeo: boolean;
  /** When true, the hero is omitted + "Refresh now" moves into the
   * niche bar. Used when this component is mounted as a tab inside
   * Product Hunter (which already has its own hero). The standalone
   * /daily-trending page uses `embedded=false` (default). */
  embedded?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const [showNicheModal, setShowNicheModal] = useState(false);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/daily-trending");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as FeedResponse;
      setFeed(data);
    } catch (err) {
      toast.error("Couldn't load trending feed", {
        description: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  // CEO-only manual cron trigger. Useful for first-day testing and
  // same-day re-runs after adding new niches.
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/cron/daily-trending", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as {
        ok: boolean;
        nichesScanned: number;
        productsAdded: number;
      };
      toast.success(
        `Refreshed — ${data.productsAdded} new products across ${data.nichesScanned} niches.`,
      );
      // Re-fetch the feed to pick up the new rows
      await fetchFeed();
    } catch (err) {
      toast.error("Refresh failed", {
        description: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleClaim(productId: string) {
    if (busyClaimId) return;
    setBusyClaimId(productId);
    try {
      const res = await fetch(
        `/api/daily-trending/${productId}/claim`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as { claimedByName: string };
      // Local patch — flip the card to "claimed by you" without
      // a full feed re-fetch
      setFeed((prev) =>
        prev ? patchClaim(prev, productId, currentUserId, data.claimedByName) : prev,
      );
      toast.success(`Claimed`, {
        description:
          "Others see it's yours — you have first dibs on listing this.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      toast.error("Couldn't claim", { description: msg });
      // Refetch in case of race-condition stale state
      await fetchFeed();
    } finally {
      setBusyClaimId(null);
    }
  }

  async function handleUnclaim(productId: string) {
    if (busyClaimId) return;
    setBusyClaimId(productId);
    try {
      const res = await fetch(
        `/api/daily-trending/${productId}/claim`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      setFeed((prev) => (prev ? patchUnclaim(prev, productId) : prev));
      toast.success("Released the claim");
    } catch (err) {
      toast.error("Couldn't release", {
        description: err instanceof Error ? err.message : "unknown",
      });
      await fetchFeed();
    } finally {
      setBusyClaimId(null);
    }
  }

  const niches = feed?.niches ?? [];
  const groups = feed?.groups ?? [];
  const totalProducts = groups.reduce((acc, g) => acc + g.products.length, 0);
  const lastRefresh = feed?.fetchDate
    ? new Date(feed.fetchDate).toLocaleDateString("en-US", {
        timeZone: "Asia/Karachi",
        month: "long",
        day: "numeric",
      })
    : null;

  // When embedded (inside the Product Hunter tab), we skip our own
  // hero — Product Hunter's hero is already on the page. The standalone
  // /daily-trending URL still uses the full hero. CEO-only "Refresh
  // now" lives in the hero when not embedded, otherwise it sits inside
  // the niche bar so it's always reachable.
  const content = (
    <>
      <NicheRowBar
        niches={niches}
        onManage={() => setShowNicheModal(true)}
        embedded={embedded}
        isCeo={isCeo}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        totalFresh={totalProducts}
        lastRefresh={lastRefresh}
      />
      {loading ? (
        <LoadingState />
      ) : niches.length === 0 ? (
        <EmptyNichesState onAddFirst={() => setShowNicheModal(true)} />
      ) : groups.every((g) => g.products.length === 0) ? (
        <NoTrendingTodayState onRefresh={isCeo ? handleRefresh : undefined} />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <NicheGroupSection
              key={g.niche}
              group={g}
              currentUserId={currentUserId}
              isCeo={isCeo}
              busyClaimId={busyClaimId}
              onClaim={handleClaim}
              onUnclaim={handleUnclaim}
            />
          ))}
        </div>
      )}
      {!loading && niches.length > 0 && (
        <p className="text-center text-[11px] text-muted-foreground italic pt-4">
          Fresh batch every morning at 5 AM PKT. Yesterday&apos;s trends roll
          off the page automatically.
        </p>
      )}
    </>
  );

  // Embedded mode: just the content, no outer hero / margins / max-width
  // (the parent tab provides those). Hide the original full layout
  // beneath the early return.
  if (embedded) {
    return (
      <div className="space-y-6">
        {content}
        <NicheManagerModal
          open={showNicheModal}
          onOpenChange={setShowNicheModal}
          niches={niches.map((n) => ({ id: n.id, niche: n.niche }))}
          cap={5}
          onChanged={fetchFeed}
        />
      </div>
    );
  }

  return (
    <div className="relative pb-12">
      {/* Full-bleed hero */}
      <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
        <HeroBanner
          isCeo={isCeo}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          totalProducts={totalProducts}
          activeNiches={niches.filter((n) => n.active).length}
          lastRefresh={lastRefresh}
        />
      </div>

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Niche row + Manage button */}
        <NicheRowBar
          niches={niches}
          onManage={() => setShowNicheModal(true)}
        />

        {/* Loading / Empty / Groups */}
        {loading ? (
          <LoadingState />
        ) : niches.length === 0 ? (
          <EmptyNichesState onAddFirst={() => setShowNicheModal(true)} />
        ) : groups.every((g) => g.products.length === 0) ? (
          <NoTrendingTodayState onRefresh={isCeo ? handleRefresh : undefined} />
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <NicheGroupSection
                key={g.niche}
                group={g}
                currentUserId={currentUserId}
                isCeo={isCeo}
                busyClaimId={busyClaimId}
                onClaim={handleClaim}
                onUnclaim={handleUnclaim}
              />
            ))}
          </div>
        )}

        {/* Footer note */}
        {!loading && niches.length > 0 && (
          <p className="text-center text-[11px] text-muted-foreground italic pt-4">
            Fresh batch every morning at 5 AM PKT. Yesterday&apos;s trends roll
            off the page automatically.
          </p>
        )}
      </div>

      {/* Niche manager modal */}
      <NicheManagerModal
        open={showNicheModal}
        onOpenChange={setShowNicheModal}
        niches={niches.map((n) => ({ id: n.id, niche: n.niche }))}
        cap={5}
        onChanged={fetchFeed}
      />
    </div>
  );
}

// ─── Local patch helpers (no extra fetch on claim/unclaim) ──────────

function patchClaim(
  feed: FeedResponse,
  productId: string,
  userId: string,
  userName: string,
): FeedResponse {
  return {
    ...feed,
    groups: feed.groups.map((g) => ({
      ...g,
      products: g.products.map((p) =>
        p.id === productId
          ? { ...p, claimedById: userId, claimedByName: userName }
          : p,
      ),
    })),
  };
}

function patchUnclaim(feed: FeedResponse, productId: string): FeedResponse {
  return {
    ...feed,
    groups: feed.groups.map((g) => ({
      ...g,
      products: g.products.map((p) =>
        p.id === productId
          ? { ...p, claimedById: null, claimedByName: null }
          : p,
      ),
    })),
  };
}

// ─── Hero banner ────────────────────────────────────────────────────

function HeroBanner({
  isCeo,
  refreshing,
  onRefresh,
  totalProducts,
  activeNiches,
  lastRefresh,
}: {
  isCeo: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  totalProducts: number;
  activeNiches: number;
  lastRefresh: string | null;
}) {
  return (
    <div className="relative overflow-hidden shadow-xl shadow-orange-500/15 ap-stagger-in border-b border-white/10">
      <div className="absolute inset-0 bg-gradient-to-br from-[#2a0d10] via-[#26121a] to-[#0d0d2a]" />
      <div
        aria-hidden
        className="absolute -top-32 -left-20 size-[420px] rounded-full blur-3xl ap-aurora-1"
        style={{
          background:
            "radial-gradient(closest-side, rgba(251,146,60,0.55), rgba(251,146,60,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-0 size-[520px] rounded-full blur-3xl ap-aurora-2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(244,63,94,0.55), rgba(244,63,94,0) 70%)",
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

      <div className="relative max-w-5xl mx-auto px-7 sm:px-9 py-8 sm:py-10">
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold text-white tracking-[0.22em] uppercase bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/20 shadow-inner">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-300 opacity-80" />
              <span className="relative inline-flex size-2 rounded-full bg-orange-400" />
            </span>
            Live · Beta
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/90 tracking-[0.16em] uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
            <Flame className="size-3" />
            Daily feed
          </span>
          {isCeo && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.16em] uppercase bg-gradient-to-r from-orange-500/85 to-rose-600/85 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-orange-300/40 shadow-md shadow-orange-500/25 hover:from-orange-500 hover:to-rose-600 transition-colors disabled:opacity-60"
              title="Force a fresh fetch now (CEO only)"
            >
              {refreshing ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Fetching…
                </>
              ) : (
                <>
                  <RefreshCw className="size-3" />
                  Refresh now
                </>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-orange-400/40 to-rose-500/40 blur-lg ap-orb-pulse"
            />
            <div className="relative size-16 sm:size-[68px] rounded-2xl bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/30 flex items-center justify-center backdrop-blur-md shadow-2xl shadow-orange-900/40">
              <Flame className="size-7 sm:size-8 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.05]">
              Daily Trending
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          <FeatureCell
            icon={Bookmark}
            label={`${activeNiches} niche${activeNiches === 1 ? "" : "s"}`}
            sub="Your niche book"
          />
          <FeatureCell
            icon={TrendingUp}
            label={`${totalProducts} fresh`}
            sub={lastRefresh ? `Today · ${lastRefresh}` : "Today's batch"}
          />
          <FeatureCell
            icon={Sparkles}
            label="5 AM PKT"
            sub="Auto-refresh daily"
          />
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
        <p className="text-[10px] text-white/55 leading-tight truncate">
          {sub}
        </p>
      </div>
    </div>
  );
}

// ─── Niche row bar ──────────────────────────────────────────────────

function NicheRowBar({
  niches,
  onManage,
  // Optional embedded-mode controls. When `embedded=true` we inline
  // the "Refresh now" button + a short last-refresh label here, so
  // the user keeps those controls without the Product Hunter hero
  // (which doesn't carry them — it's a Hunter-wide hero, not
  // tab-specific).
  embedded = false,
  isCeo = false,
  refreshing = false,
  onRefresh,
  totalFresh,
  lastRefresh,
}: {
  niches: Array<{ id: string; niche: string; active: boolean }>;
  onManage: () => void;
  embedded?: boolean;
  isCeo?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  totalFresh?: number;
  lastRefresh?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap rounded-2xl border border-border/60 bg-card px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Your niches:
        </span>
        {niches.length === 0 ? (
          <span className="text-[12px] text-muted-foreground italic">
            None yet — add your first to start receiving trends
          </span>
        ) : (
          niches.map((n) => (
            <span
              key={n.id}
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ${
                n.active
                  ? "bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-orange-500/20"
                  : "bg-muted text-muted-foreground ring-border/40"
              }`}
            >
              {n.niche}
            </span>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {embedded && typeof totalFresh === "number" && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums hidden sm:inline">
            {totalFresh} fresh
            {lastRefresh ? ` · ${lastRefresh}` : ""}
          </span>
        )}
        {embedded && isCeo && onRefresh && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={refreshing}
            className="h-8 gap-1.5 text-[11px]"
            title="Force a fresh fetch now (CEO only)"
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onManage}
          className="h-8 gap-1.5 text-[11px]"
        >
          <Settings2 className="size-3.5" />
          Manage niches
        </Button>
      </div>
    </div>
  );
}

// ─── Group section ──────────────────────────────────────────────────

function NicheGroupSection({
  group,
  currentUserId,
  isCeo,
  busyClaimId,
  onClaim,
  onUnclaim,
}: {
  group: NicheGroup;
  currentUserId: string;
  isCeo: boolean;
  busyClaimId: string | null;
  onClaim: (id: string) => void;
  onUnclaim: (id: string) => void;
}) {
  const fresh = group.products.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-base sm:text-lg font-bold tracking-tight uppercase">
          {group.niche}
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
          {fresh} fresh today
        </span>
      </div>
      {fresh === 0 ? (
        <Card className="border border-dashed border-border/60 shadow-none">
          <CardContent className="p-6 text-center">
            <p className="text-[12px] text-muted-foreground">
              No fresh trends today for this niche. Tomorrow&apos;s 5 AM PKT
              run will try again.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {group.products.map((p) => (
            <TrendingCard
              key={p.id}
              product={p}
              currentUserId={currentUserId}
              isCeo={isCeo}
              busy={busyClaimId === p.id}
              onClaim={onClaim}
              onUnclaim={onUnclaim}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Empty + loading states ─────────────────────────────────────────

function LoadingState() {
  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-border/60 bg-card overflow-hidden"
        >
          <div className="aspect-square bg-muted/40 animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-3 w-4/5 rounded bg-muted/60 animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-muted/40 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyNichesState({ onAddFirst }: { onAddFirst: () => void }) {
  return (
    <Card className="border border-border/60 shadow-none">
      <CardContent className="p-8 sm:p-12 text-center space-y-4">
        <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/15 to-rose-500/15 ring-1 ring-orange-500/30 mx-auto">
          <Bookmark className="size-6 text-orange-600 dark:text-orange-400" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold tracking-tight">
            Add your first niche
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Pick the niches your shop sells — boho jewelry, cottagecore decor,
            anything goes. We&apos;ll surface fresh AliExpress winners every
            morning.
          </p>
        </div>
        <Button
          type="button"
          onClick={onAddFirst}
          className="gap-1.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600"
        >
          <Settings2 className="size-3.5" />
          Add a niche
        </Button>
      </CardContent>
    </Card>
  );
}

function NoTrendingTodayState({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <Card className="border border-border/60 shadow-none">
      <CardContent className="p-8 sm:p-10 text-center space-y-3">
        <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-muted/60 mx-auto">
          <Flame className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-base font-bold tracking-tight">
          No trends today yet
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The 5 AM PKT cron hasn&apos;t produced fresh products for your niches
          yet. New niches start producing trends in the next morning&apos;s
          batch.
        </p>
        {onRefresh && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Force refresh now
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
