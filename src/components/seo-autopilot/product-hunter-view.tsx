"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Sparkles,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  TrendingUp,
  Users,
  Target,
  Lightbulb,
  Crown,
  Zap,
  Heart,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────

type Verdict = "GREAT" | "GOOD" | "MAYBE" | "SKIP";

interface ProductHuntResult {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  uniqueShops: number;
  wordCount: number;
  score: number;
  verdict: Verdict;
  reasons: string[];
  topListings: Array<{
    title: string;
    favorites: number;
    listingId: number;
    url?: string;
  }>;
}

interface ScanResponse {
  seedKeyword: string;
  scanCount: number;
  evaluated: number;
  totalCostUsd: number;
  durationMs: number;
  results: ProductHuntResult[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

const VERDICT_STYLE: Record<
  Verdict,
  { ring: string; chip: string; gradient: string; icon: string; label: string }
> = {
  GREAT: {
    ring: "ring-emerald-500/40",
    chip: "bg-emerald-500 text-white",
    gradient: "from-emerald-500/15 via-emerald-500/8 to-transparent",
    icon: "text-emerald-600 dark:text-emerald-400",
    label: "Hunt this",
  },
  GOOD: {
    ring: "ring-sky-500/40",
    chip: "bg-sky-500 text-white",
    gradient: "from-sky-500/15 via-sky-500/8 to-transparent",
    icon: "text-sky-600 dark:text-sky-400",
    label: "Worth a look",
  },
  MAYBE: {
    ring: "ring-amber-500/40",
    chip: "bg-amber-500 text-white",
    gradient: "from-amber-500/15 via-amber-500/8 to-transparent",
    icon: "text-amber-600 dark:text-amber-400",
    label: "Maybe",
  },
  SKIP: {
    ring: "ring-rose-500/30",
    chip: "bg-rose-500 text-white",
    gradient: "from-rose-500/10 via-rose-500/5 to-transparent",
    icon: "text-rose-600 dark:text-rose-400",
    label: "Skip",
  },
};

// ─── Main view ──────────────────────────────────────────────────────

type VerdictFilter = "all" | "great" | "good" | "maybe" | "skip";

export function ProductHunterView() {
  const [seed, setSeed] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");

  async function handleScan() {
    if (seed.trim().length < 2 || scanning) return;
    setScanning(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const res = await fetch("/api/seo-autopilot/hunt-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedKeyword: seed.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as ScanResponse;
      setResult(data);
      toast.success(
        `Scanned ${data.evaluated} variants in ${(data.durationMs / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      setErrorMsg(msg);
      toast.error("Scan failed", { description: msg });
    } finally {
      setScanning(false);
    }
  }

  function handleReset() {
    setSeed("");
    setResult(null);
    setErrorMsg(null);
    setVerdictFilter("all");
  }

  const filtered =
    result?.results.filter((r) => {
      if (verdictFilter === "all") return true;
      return r.verdict === verdictFilter.toUpperCase();
    }) ?? [];

  return (
    <div className="relative max-w-5xl mx-auto space-y-6 pb-12">
      <HeroBanner scanning={scanning} hasResult={!!result} />

      {!result && !scanning && (
        <InputCard
          seed={seed}
          onSeedChange={setSeed}
          disabled={scanning}
          onScan={handleScan}
        />
      )}

      {scanning && <ScanProgress seed={seed} />}

      {errorMsg && !scanning && <ErrorPanel message={errorMsg} />}

      {result && !scanning && (
        <>
          <ScanSummary
            result={result}
            verdictFilter={verdictFilter}
            onVerdictFilter={setVerdictFilter}
            onReset={handleReset}
          />
          {filtered.length === 0 ? (
            <Card className="border border-border/60">
              <CardContent className="p-10 text-center">
                <Target className="size-7 text-muted-foreground/60 mx-auto mb-2" />
                <p className="text-sm font-bold">No results match that filter</p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Try a wider verdict filter, or scan a different seed.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((r, i) => (
                <HuntResultRow
                  key={r.keyword}
                  result={r}
                  rank={i + 1}
                  animationDelay={i * 30}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Hero banner ────────────────────────────────────────────────────

function HeroBanner({
  scanning,
  hasResult,
}: {
  scanning: boolean;
  hasResult: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-violet-500/20 ap-stagger-in">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d1a2a] via-[#1a1226] to-[#0d1a2a]" />
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

      <div className="relative px-7 sm:px-9 py-8 sm:py-10">
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
            Pre-listing intelligence
          </span>
          {scanning && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.16em] uppercase bg-violet-500/30 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-violet-300/40">
              <Loader2 className="size-3 animate-spin" />
              Scanning
            </span>
          )}
          {hasResult && !scanning && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-200 tracking-[0.16em] uppercase bg-emerald-500/20 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-emerald-300/30">
              <Check className="size-3" />
              Results ready
            </span>
          )}
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
            <p className="text-[13px] sm:text-sm text-white/75 mt-2 leading-relaxed max-w-2xl">
              Find underserved Etsy niches before the team hunts AliExpress.
              Paste a seed product type — Autopilot brainstorms 25 long-tail
              variants and scores each one against live Etsy demand,
              engagement, and shop diversity.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-7 pt-5 border-t border-white/10">
          <FeatureCell icon={Zap} label="25 variants" sub="Haiku brainstorm" />
          <FeatureCell icon={TrendingUp} label="Live Etsy" sub="Demand · favorites · shops" />
          <FeatureCell icon={Lightbulb} label="Ranked" sub="GREAT · GOOD · MAYBE · SKIP" />
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

// ─── Input card ─────────────────────────────────────────────────────

function InputCard({
  seed,
  onSeedChange,
  disabled,
  onScan,
}: {
  seed: string;
  onSeedChange: (v: string) => void;
  disabled: boolean;
  onScan: () => void;
}) {
  const valid = seed.trim().length >= 2;
  return (
    <Card
      className="border border-border/60 bg-card/95 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_12px_36px_-12px_rgba(0,0,0,0.5)] ap-stagger-in"
      style={{ animationDelay: "120ms" }}
    >
      <CardContent className="p-7 sm:p-8 space-y-5">
        <div className="flex items-center gap-3.5">
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-sky-400/30 to-violet-500/30 blur-md"
            />
            <div className="relative size-11 rounded-2xl bg-gradient-to-br from-sky-500 to-violet-600 ring-1 ring-violet-700/30 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Search className="size-5 text-white" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-[0.22em]">
              Step one
            </p>
            <h3 className="text-[17px] font-bold tracking-tight leading-tight mt-0.5">
              What kind of product are you considering?
            </h3>
            <p className="text-[12px] text-muted-foreground/80 mt-0.5">
              A category or product type works best — broader than a specific listing.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Input
            type="text"
            value={seed}
            onChange={(e) => onSeedChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !disabled) onScan();
            }}
            placeholder="e.g. leather wallet · linen pants · phone case · macrame wall hanging"
            disabled={disabled}
            className="h-12 text-sm bg-muted/20 border-border/70 focus-visible:border-sky-500/60 focus-visible:ring-sky-500/15 placeholder:text-muted-foreground/55"
          />
          <p className="text-[11px] text-muted-foreground/70 leading-snug">
            Tip: scan the category your team is about to hunt — Autopilot will
            surface the angles within it that are actually winnable.
          </p>
        </div>

        <div className="relative group">
          <div
            aria-hidden
            className={`absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-sky-500 via-violet-500 to-pink-600 blur-md transition-opacity ${valid ? "opacity-50 group-hover:opacity-75" : "opacity-0"}`}
          />
          <Button
            type="button"
            onClick={onScan}
            disabled={!valid || disabled}
            className="relative w-full h-14 gap-3 bg-gradient-to-r from-sky-500 via-violet-500 to-violet-600 hover:from-sky-500 hover:via-violet-500 hover:to-violet-600 text-white font-bold text-[15px] tracking-wide rounded-2xl shadow-xl shadow-violet-500/30 ring-1 ring-violet-700/30 hover:shadow-2xl hover:shadow-violet-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <Search className="size-5" />
            <span>Hunt products</span>
            <span className="ml-1 text-xs font-semibold opacity-80 hidden sm:inline">
              · ~10s
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Scanning progress ──────────────────────────────────────────────

function ScanProgress({ seed }: { seed: string }) {
  return (
    <Card className="border border-border/60 ap-stagger-in overflow-hidden relative">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-sky-50/50 via-transparent to-violet-50/40 dark:from-sky-950/15 dark:via-transparent dark:to-violet-950/15"
      />
      <CardContent className="relative p-8 sm:p-10">
        <div className="flex flex-col items-center text-center">
          <div className="relative size-28 mb-5">
            <div
              aria-hidden
              className="absolute -inset-6 rounded-full bg-gradient-to-br from-sky-400/30 to-violet-500/30 blur-2xl ap-orb-pulse"
            />
            <div
              aria-hidden
              className="absolute inset-0 rounded-full ring-2 ring-sky-400/30 ap-orb-spin"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 size-3 rounded-full bg-sky-500 shadow-lg shadow-sky-500/60" />
            </div>
            <div
              aria-hidden
              className="absolute inset-3 rounded-full ring-2 ring-violet-400/30 ap-orb-spin"
              style={{ animationDirection: "reverse", animationDuration: "11s" }}
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 size-2.5 rounded-full bg-violet-500 shadow-lg shadow-violet-500/60" />
            </div>
            <div className="absolute inset-6 rounded-full bg-gradient-to-br from-sky-500 to-violet-600 ring-1 ring-white/30 flex items-center justify-center shadow-2xl shadow-violet-500/40">
              <Target className="size-7 text-white" />
            </div>
          </div>

          <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-[0.22em] mb-1">
            Scanning Etsy
          </p>
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight">
            &ldquo;{seed}&rdquo;
          </h3>
          <p className="text-[13px] text-muted-foreground mt-1.5 max-w-md">
            Brainstorming 25 long-tail variants, then asking Etsy for live
            demand on each. Usually 7-15 seconds.
          </p>

          <div className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80 tabular-nums">
            <Loader2 className="size-3 animate-spin" />
            <span>Querying live Etsy data</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Error panel ────────────────────────────────────────────────────

function ErrorPanel({ message }: { message: string }) {
  return (
    <Card className="border-rose-300/50 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 shadow-none ap-stagger-in">
      <CardContent className="p-5 flex items-start gap-3">
        <div className="size-9 rounded-xl bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0">
          <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
            Scan failed
          </p>
          <p className="text-[12px] text-rose-700/90 dark:text-rose-300/80 mt-1 leading-relaxed">
            {message}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Scan summary header ────────────────────────────────────────────

function ScanSummary({
  result,
  verdictFilter,
  onVerdictFilter,
  onReset,
}: {
  result: ScanResponse;
  verdictFilter: VerdictFilter;
  onVerdictFilter: (v: VerdictFilter) => void;
  onReset: () => void;
}) {
  const counts = result.results.reduce(
    (acc, r) => {
      acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
      return acc;
    },
    { GREAT: 0, GOOD: 0, MAYBE: 0, SKIP: 0 } as Record<Verdict, number>,
  );

  return (
    <Card
      className="border border-border/60 ap-stagger-in"
      style={{ animationDelay: "0ms" }}
    >
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Scanned
            </p>
            <p className="text-xl font-bold leading-tight tracking-tight mt-0.5">
              &ldquo;{result.seedKeyword}&rdquo;
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
              {result.evaluated} of {result.scanCount} variants scored ·{" "}
              {(result.durationMs / 1000).toFixed(1)}s · $
              {result.totalCostUsd.toFixed(4)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            size="sm"
            className="gap-1.5"
          >
            <Search className="size-3" />
            New scan
          </Button>
        </div>

        {/* Verdict filter pills */}
        <div className="flex flex-wrap gap-1.5">
          <FilterPill
            label="All"
            value="all"
            count={result.results.length}
            active={verdictFilter === "all"}
            onClick={() => onVerdictFilter("all")}
          />
          <FilterPill
            label="Hunt this"
            value="great"
            count={counts.GREAT}
            tone="emerald"
            active={verdictFilter === "great"}
            onClick={() => onVerdictFilter("great")}
          />
          <FilterPill
            label="Worth a look"
            value="good"
            count={counts.GOOD}
            tone="sky"
            active={verdictFilter === "good"}
            onClick={() => onVerdictFilter("good")}
          />
          <FilterPill
            label="Maybe"
            value="maybe"
            count={counts.MAYBE}
            tone="amber"
            active={verdictFilter === "maybe"}
            onClick={() => onVerdictFilter("maybe")}
          />
          <FilterPill
            label="Skip"
            value="skip"
            count={counts.SKIP}
            tone="rose"
            active={verdictFilter === "skip"}
            onClick={() => onVerdictFilter("skip")}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function FilterPill({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: VerdictFilter;
  count: number;
  tone?: "emerald" | "sky" | "amber" | "rose";
  active: boolean;
  onClick: () => void;
}) {
  const toneRingActive = tone
    ? {
        emerald: "ring-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        sky: "ring-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300",
        amber: "ring-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
        rose: "ring-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300",
      }[tone]
    : "ring-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition-colors ${
        active
          ? toneRingActive
          : "bg-muted/30 ring-border/60 text-muted-foreground hover:text-foreground hover:ring-border"
      }`}
    >
      {label}
      <span className={`tabular-nums text-[10px] font-bold opacity-80`}>
        {count}
      </span>
    </button>
  );
}

// ─── Single hunt-result row ─────────────────────────────────────────

function HuntResultRow({
  result,
  rank,
  animationDelay,
}: {
  result: ProductHuntResult;
  rank: number;
  animationDelay: number;
}) {
  const style = VERDICT_STYLE[result.verdict];
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.keyword);
    setCopied(true);
    toast.success(`Copied "${result.keyword}"`);
    setTimeout(() => setCopied(false), 1500);
  };

  const aliExpressUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(result.keyword)}`;
  const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(result.keyword)}`;

  return (
    <Card
      className={`border border-border/60 hover:border-border transition-colors overflow-hidden ap-stagger-in`}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className={`relative ${result.verdict === "GREAT" || result.verdict === "GOOD" ? "p-5" : "p-4"}`}>
        {/* Tone wash for GREAT/GOOD rows */}
        {(result.verdict === "GREAT" || result.verdict === "GOOD") && (
          <div
            aria-hidden
            className={`absolute inset-0 bg-gradient-to-r pointer-events-none ${style.gradient}`}
          />
        )}

        <div className="relative flex items-start gap-3">
          {/* Rank chip */}
          <div
            className={`size-11 rounded-xl ring-1 flex items-center justify-center shrink-0 shadow-md ${style.chip} ${style.ring}`}
          >
            {rank === 1 ? (
              <Crown className="size-5" />
            ) : (
              <span className="text-[14px] font-bold tabular-nums">#{rank}</span>
            )}
          </div>

          {/* Main content */}
          <div className="min-w-0 flex-1">
            {/* Verdict + keyword */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] ring-1 ${
                  result.verdict === "GREAT"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30"
                    : result.verdict === "GOOD"
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30"
                      : result.verdict === "MAYBE"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
                        : "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30"
                }`}
              >
                {result.verdict}
              </span>
              <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
                {result.score}/100
              </span>
            </div>

            <h3 className="text-[15px] sm:text-base font-bold leading-tight mt-1.5 tracking-tight">
              {result.keyword}
            </h3>

            {/* Stats strip */}
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <StatTile
                icon={TrendingUp}
                label="Listings"
                value={formatCount(result.totalListings)}
              />
              <StatTile
                icon={Heart}
                label="Avg favs"
                value={formatCount(result.avgTopFavorites)}
              />
              <StatTile
                icon={Users}
                label="Shops in top 10"
                value={result.uniqueShops.toString()}
              />
            </div>

            {/* Reasons */}
            {result.reasons.length > 0 && (
              <ul className="mt-3 space-y-1">
                {result.reasons.map((r, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-muted-foreground leading-snug flex items-start gap-1.5"
                  >
                    <span
                      className={`mt-1 size-1 rounded-full shrink-0 ${
                        result.verdict === "GREAT" || result.verdict === "GOOD"
                          ? "bg-emerald-500"
                          : result.verdict === "MAYBE"
                            ? "bg-amber-500"
                            : "bg-rose-500"
                      }`}
                    />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Top 3 example listings — collapsed by default */}
            {result.topListings.length > 0 && (
              <details className="mt-3 group">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors list-none flex items-center gap-1">
                  <ArrowRight className="size-2.5 transition-transform group-open:rotate-90" />
                  See top {result.topListings.length} ranking listings
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {result.topListings.map((l) => (
                    <li
                      key={l.listingId}
                      className="rounded-md bg-muted/20 ring-1 ring-border/40 px-3 py-2 flex items-start gap-2"
                    >
                      <Heart
                        className="size-3 text-rose-500 mt-0.5 shrink-0"
                        fill="currentColor"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] leading-snug line-clamp-2">
                          {l.title}
                        </p>
                        <p className="text-[10px] font-bold tabular-nums text-muted-foreground mt-0.5">
                          {l.favorites.toLocaleString()} favorites
                        </p>
                      </div>
                      {l.url && (
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
                          title="Open on Etsy"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
              >
                {copied ? (
                  <Check className="size-2.5 text-emerald-500" strokeWidth={3} />
                ) : (
                  <Copy className="size-2.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={aliExpressUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow shadow-orange-500/30 hover:opacity-90 transition-opacity"
              >
                <ExternalLink className="size-2.5" />
                Hunt on AliExpress
              </a>
              <a
                href={etsyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-border/70 hover:bg-muted/60 transition-colors"
              >
                <ExternalLink className="size-2.5" />
                See on Etsy
              </a>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md bg-muted/20 ring-1 ring-border/40 px-2 py-1.5 min-w-0">
      <div className="flex items-center gap-1 text-muted-foreground">
        <Icon className="size-2.5 shrink-0" />
        <p className="text-[9px] font-bold uppercase tracking-wider truncate">
          {label}
        </p>
      </div>
      <p className="text-[13px] font-bold tabular-nums leading-tight">
        {value}
      </p>
    </div>
  );
}

