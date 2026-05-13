"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  Wand2,
  Copy,
  Check,
  ChevronDown,
  Search,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Tags,
  FileText,
  Type,
  Image as ImageIcon,
  Layers,
  Crown,
  TrendingUp,
  ListChecks,
  Lightbulb,
  RotateCw,
  Zap,
  Heart,
  Hash,
  Target,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types — mirror the API shape ────────────────────────────────────

interface GeneratedListing {
  title: string;
  tags: string[];
  description: string;
  materials: string[];
  attributes: { name: string; value: string }[];
  altText: string;
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
}

interface ComplianceReport {
  ok: boolean;
  issues: { severity: "warn" | "block"; field: string; message: string }[];
}

interface ResearchSummary {
  searchKeyword: string;
  productType: string;
  audienceHint: string;
  styleHint: string;
  categoryPath: string;
  categoryId: number;
  competitorsAnalyzed: number;
  topCompetitors: { rank: number; title: string; favorites: number }[];
  attributesAvailable: number;
}

interface GenerateResponse {
  listing: GeneratedListing;
  compliance: ComplianceReport;
  research: ResearchSummary;
  generatedAt: string;
}

// ─── Etsy hard limits — also enforced server-side ────────────────────

const TITLE_MAX = 140;
const TAG_MAX = 20;

// ─── Main component ──────────────────────────────────────────────────

/**
 * SEO Autopilot — full SaaS view (CEO-only).
 *
 * One-input UX (revised May 13 2026):
 *   • One big textarea: paste the AliExpress title (or any description)
 *   • One small textarea: optional "anything to highlight"
 *   • Generate → backend extracts keyword + category automatically and
 *     returns the full listing.
 *
 * The user used to have to pick a keyword, category, audience, style,
 * and shop maturity — Wasif: "why is this asking so many things?".
 * Now Autopilot does the work.
 */
export function SeoAutopilotView() {
  // ─── Form state ─────────────────────────────────────────────────────
  const [aliTitle, setAliTitle] = useState("");
  const [notes, setNotes] = useState("");

  // ─── Generation state ───────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "reading" | "researching" | "writing" | "auditing"
  >("idle");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ─── Derived ───────────────────────────────────────────────────────
  const titleValid = aliTitle.trim().length >= 8;
  const canSubmit = titleValid && !generating;

  // ─── Submit ────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!canSubmit) return;
    setGenerating(true);
    setErrorMsg(null);
    setResult(null);
    setStage("reading");

    // The server flow is opaque to the client. Fake progressive stages
    // on a timer so the UI feels responsive. Approx wall time: 8-14s.
    const t1 = setTimeout(() => setStage("researching"), 1800);
    const t2 = setTimeout(() => setStage("writing"), 4500);
    const t3 = setTimeout(() => setStage("auditing"), 9500);

    try {
      const res = await fetch("/api/seo-autopilot/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aliExpressTitle: aliTitle.trim(),
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Generation failed (${res.status})`);
      }

      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStage("idle");
      toast.success("Listing ready", {
        description: `Picked category: ${data.research.categoryPath}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setErrorMsg(message);
      toast.error("Generation failed", {
        description: message || "Try again — the model or Etsy API may be busy.",
      });
      setStage("idle");
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setGenerating(false);
    }
  }

  function handleReset() {
    setAliTitle("");
    setNotes("");
    setResult(null);
    setErrorMsg(null);
  }

  return (
    <div className="space-y-6">
      <HeroBanner />

      {/* ─────────────── Input card ─────────────── */}
      <Card className="border shadow-none overflow-hidden">
        <CardContent className="p-5 sm:p-6 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-7 rounded-lg bg-gradient-to-br from-orange-500/15 to-violet-500/15 ring-1 ring-orange-500/20 flex items-center justify-center">
                  <Type className="size-3.5 text-orange-600 dark:text-orange-400" />
                </div>
                <label
                  htmlFor="ali-title"
                  className="text-sm font-semibold tracking-tight"
                >
                  Paste your AliExpress title
                </label>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {aliTitle.trim().length} chars
              </span>
            </div>
            <Textarea
              id="ali-title"
              value={aliTitle}
              onChange={(e) => setAliTitle(e.target.value)}
              placeholder="ROSES Pearl Gorgeous Prom Dress Sweetheart Off the Shoulder Hollow Prom Gown with Fishbone Shiny Sequins Formal Gown Customized"
              className="min-h-[96px] resize-none text-sm"
              disabled={generating}
            />
            <p className="text-[10px] text-muted-foreground/80 leading-snug">
              Autopilot will read this and figure out the Etsy keyword,
              category, audience, and style on its own.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-lg bg-muted/60 flex items-center justify-center">
                <Lightbulb className="size-3.5 text-muted-foreground" />
              </div>
              <label
                htmlFor="notes"
                className="text-sm font-semibold tracking-tight"
              >
                Anything to highlight?{" "}
                <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wider ml-1">
                  Optional
                </span>
              </label>
            </div>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Available in sizes 0-20 · Made-to-measure · Sweetheart neckline · For prom, wedding guest, formal events"
              className="min-h-[64px] resize-none text-sm"
              disabled={generating}
            />
          </div>

          <div className="pt-1 space-y-2">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!canSubmit}
              className="w-full h-12 gap-2 bg-gradient-to-r from-[#F1641E] via-orange-500 to-violet-600 text-white font-semibold text-sm shadow-lg shadow-orange-500/20 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating
                </>
              ) : (
                <>
                  <Wand2 className="size-4" />
                  Generate Etsy listing
                </>
              )}
            </Button>
            {(aliTitle || notes) && !generating && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="w-full text-xs"
              >
                <RotateCw className="size-3" />
                Reset
              </Button>
            )}
            {!titleValid && aliTitle.length > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 text-center">
                Paste at least 8 characters of title text.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─────────────── Output ─────────────── */}
      <div>
        {generating && <GeneratingPanel stage={stage} />}
        {errorMsg && !generating && <ErrorPanel message={errorMsg} />}
        {!generating && !result && !errorMsg && <EmptyPanel />}
        {!generating && result && <ResultPanel data={result} />}
      </div>
    </div>
  );
}

// ─── Hero banner ─────────────────────────────────────────────────────

function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#F1641E] via-orange-600 to-violet-700 shadow-lg shadow-orange-500/20 ring-1 ring-orange-700/40">
      <div
        aria-hidden
        className="absolute -top-16 -left-12 size-56 rounded-full bg-amber-300/30 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -bottom-20 -right-12 size-64 rounded-full bg-violet-400/30 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent 0, transparent 18px, rgba(255,255,255,0.6) 18px, rgba(255,255,255,0.6) 19px)",
        }}
      />

      <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 px-5 sm:px-7 py-5">
        <div className="relative shrink-0">
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-white/40 animate-pulse blur-sm"
          />
          <div className="relative size-12 rounded-xl bg-white/15 ring-1 ring-white/40 flex items-center justify-center backdrop-blur-sm shadow-inner">
            <Sparkles className="size-6 text-white" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white tracking-[0.18em] uppercase bg-white/15 backdrop-blur-sm px-2 py-0.5 rounded-full ring-1 ring-white/25">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-300" />
              </span>
              Private beta · CEO only
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white/90 tracking-wider uppercase bg-black/15 backdrop-blur-sm px-2 py-0.5 rounded-full">
              <Zap className="size-3" />
              Claude + Etsy live data
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-tight">
            SEO Autopilot
          </h2>
          <p className="text-[12px] sm:text-sm text-white/85 mt-1 leading-snug max-w-2xl">
            Paste your AliExpress title → get a complete, compliance-checked
            Etsy listing back. Autopilot reads live{" "}
            <span className="underline decoration-white/70 decoration-2 underline-offset-[3px] font-semibold">
              ranking data
            </span>{" "}
            and figures out the keyword, category, and style on its own.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Output panels ──────────────────────────────────────────────────

function EmptyPanel() {
  return (
    <Card className="border-dashed border-2 shadow-none">
      <CardContent className="py-14 px-6 text-center">
        <div className="inline-flex size-14 rounded-2xl bg-gradient-to-br from-orange-500/15 to-violet-500/15 ring-1 ring-orange-500/20 items-center justify-center mb-4">
          <Sparkles className="size-7 text-orange-500" />
        </div>
        <h3 className="text-base font-semibold tracking-tight">
          Ready when you are
        </h3>
        <p className="text-[12px] text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
          Paste an AliExpress title above and hit{" "}
          <span className="font-semibold text-foreground">Generate</span> —
          Autopilot will read it, search Etsy for the best matches, pick the
          right category, and write the whole listing.
        </p>
        <div className="mt-5 grid grid-cols-4 gap-2 max-w-2xl mx-auto">
          <EmptyPill icon={Type} label="Read title" sub="Haiku" />
          <EmptyPill icon={Search} label="Research" sub="20 top listings" />
          <EmptyPill icon={Wand2} label="Generate" sub="Sonnet" />
          <EmptyPill icon={ShieldCheck} label="Audit" sub="Haiku" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyPill({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-2 py-2 text-center">
      <Icon className="size-3.5 mx-auto text-muted-foreground" />
      <p className="text-[11px] font-semibold mt-1">{label}</p>
      <p className="text-[9px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function GeneratingPanel({
  stage,
}: {
  stage: "idle" | "reading" | "researching" | "writing" | "auditing";
}) {
  return (
    <Card className="border shadow-none overflow-hidden relative">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-orange-50/60 via-card to-violet-50/40 dark:from-orange-950/20 dark:via-card dark:to-violet-950/20 pointer-events-none"
      />
      <CardContent className="relative py-10 px-6">
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center">
            <div className="inline-flex size-14 rounded-2xl bg-gradient-to-br from-orange-500 to-violet-600 items-center justify-center shadow-lg shadow-orange-500/30 mb-4">
              <Loader2 className="size-7 text-white animate-spin" />
            </div>
            <h3 className="text-base font-semibold tracking-tight">
              Autopilot is working
            </h3>
            <p className="text-[12px] text-muted-foreground mt-1">
              Usually 8-14 seconds.
            </p>
          </div>

          <div className="space-y-2.5">
            <StageRow
              label="Reading your AliExpress title"
              status={stageStatus(stage, "reading")}
            />
            <StageRow
              label="Researching live Etsy ranking data"
              status={stageStatus(stage, "researching")}
            />
            <StageRow
              label="Writing original title, tags, description"
              status={stageStatus(stage, "writing")}
            />
            <StageRow
              label="Auditing for compliance & rule breaks"
              status={stageStatus(stage, "auditing")}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type Stage = "idle" | "reading" | "researching" | "writing" | "auditing";
type StageStatus = "pending" | "active" | "done";
const STAGE_ORDER = ["reading", "researching", "writing", "auditing"] as const;
type ActiveStage = (typeof STAGE_ORDER)[number];

function stageStatus(current: Stage, target: ActiveStage): StageStatus {
  if (current === "idle") return "pending";
  const curIdx = STAGE_ORDER.indexOf(current);
  const tgtIdx = STAGE_ORDER.indexOf(target);
  if (curIdx < 0) return "pending";
  if (curIdx === tgtIdx) return "active";
  if (curIdx > tgtIdx) return "done";
  return "pending";
}

function StageRow({ label, status }: { label: string; status: StageStatus }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="shrink-0">
        {status === "done" ? (
          <div className="size-5 rounded-full bg-emerald-500 flex items-center justify-center">
            <Check className="size-3 text-white" strokeWidth={3} />
          </div>
        ) : status === "active" ? (
          <Loader2 className="size-5 text-orange-500 animate-spin" />
        ) : (
          <div className="size-5 rounded-full border-2 border-muted-foreground/20" />
        )}
      </div>
      <p
        className={`text-xs font-medium ${
          status === "done"
            ? "text-foreground"
            : status === "active"
              ? "text-foreground"
              : "text-muted-foreground/60"
        }`}
      >
        {label}
      </p>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <Card className="border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 shadow-none">
      <CardContent className="p-5 flex items-start gap-3">
        <div className="size-9 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center shrink-0">
          <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
            Generation failed
          </p>
          <p className="text-[12px] text-rose-700/90 dark:text-rose-300/80 mt-1 leading-relaxed">
            {message}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultPanel({ data }: { data: GenerateResponse }) {
  const { listing, compliance, research } = data;

  return (
    <div className="space-y-4">
      <ResearchStrip research={research} />
      <ComplianceBanner report={compliance} />
      <TitleCard title={listing.title} />
      <TagsCard tags={listing.tags} />
      <DescriptionCard description={listing.description} />
      <div className="grid gap-4 md:grid-cols-2">
        <MaterialsCard materials={listing.materials} />
        <AltTextCard altText={listing.altText} />
      </div>
      {listing.attributes.length > 0 && (
        <AttributesCard attributes={listing.attributes} />
      )}
      <RationaleCard rationale={listing.rationale} />
      <CompetitorCard competitors={research.topCompetitors} />
    </div>
  );
}

// ─── Result sub-cards ───────────────────────────────────────────────

function ResearchStrip({ research }: { research: ResearchSummary }) {
  return (
    <Card className="border shadow-none overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-emerald-50/60 via-card to-emerald-50/30 dark:from-emerald-950/20 dark:via-card dark:to-emerald-950/10 pointer-events-none"
      />
      <CardContent className="relative p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center shrink-0">
            <TrendingUp className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-[0.16em]">
            Autopilot&apos;s decisions
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <DecisionRow
            icon={Search}
            label="Searched for"
            value={research.searchKeyword}
          />
          <DecisionRow
            icon={Layers}
            label="Picked category"
            value={research.categoryPath}
          />
          <DecisionRow
            icon={Target}
            label="Product type"
            value={research.productType}
          />
          <DecisionRow
            icon={Crown}
            label="Listings analyzed"
            value={`${research.competitorsAnalyzed} ranking · ${research.attributesAvailable} attribute slots`}
          />
          {research.audienceHint && (
            <DecisionRow
              icon={Heart}
              label="Audience"
              value={research.audienceHint}
            />
          )}
          {research.styleHint && (
            <DecisionRow
              icon={Sparkles}
              label="Style"
              value={research.styleHint}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 flex items-center gap-2.5">
      <Icon className="size-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
          {label}
        </p>
        <p className="text-[12px] font-semibold text-foreground/90 truncate leading-snug">
          {value}
        </p>
      </div>
    </div>
  );
}

function ComplianceBanner({ report }: { report: ComplianceReport }) {
  if (report.ok && report.issues.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-300/50 dark:border-emerald-700/40 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 flex items-center gap-3">
        <div className="size-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          Compliance: clean. No trademark, IP, or rule issues detected.
        </p>
      </div>
    );
  }

  const blocks = report.issues.filter((i) => i.severity === "block");
  const warns = report.issues.filter((i) => i.severity === "warn");
  const tone = blocks.length > 0 ? "rose" : "amber";

  return (
    <div
      className={`rounded-xl border ${
        tone === "rose"
          ? "border-rose-300/50 dark:border-rose-700/40 bg-rose-50/60 dark:bg-rose-950/20"
          : "border-amber-300/50 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-950/20"
      } p-4 space-y-3`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${
            tone === "rose" ? "bg-rose-500/15" : "bg-amber-500/15"
          }`}
        >
          <AlertTriangle
            className={`size-4 ${
              tone === "rose"
                ? "text-rose-600 dark:text-rose-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          />
        </div>
        <p
          className={`text-xs font-semibold ${
            tone === "rose"
              ? "text-rose-700 dark:text-rose-300"
              : "text-amber-700 dark:text-amber-300"
          }`}
        >
          {blocks.length > 0
            ? `${blocks.length} blocker${blocks.length === 1 ? "" : "s"} · ${warns.length} warning${warns.length === 1 ? "" : "s"}`
            : `${warns.length} warning${warns.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <ul className="space-y-1.5">
        {[...blocks, ...warns].map((iss, idx) => (
          <li
            key={idx}
            className="text-[12px] text-foreground/85 flex gap-2 items-start"
          >
            <span
              className={`mt-1 size-1.5 rounded-full shrink-0 ${
                iss.severity === "block" ? "bg-rose-500" : "bg-amber-500"
              }`}
            />
            <span>
              <span className="font-semibold uppercase text-[10px] tracking-wider mr-1.5 opacity-70">
                {iss.field}
              </span>
              {iss.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyButton({
  value,
  label,
  size = "sm",
}: {
  value: string;
  label: string;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(`Copied ${label}`);
    setTimeout(() => setCopied(false), 1800);
  }

  if (size === "xs") {
    return (
      <button
        onClick={handleCopy}
        type="button"
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md hover:bg-muted/60 text-muted-foreground transition-colors"
        title={`Copy ${label}`}
      >
        {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    );
  }

  return (
    <Button
      onClick={handleCopy}
      variant="outline"
      size="sm"
      className="gap-1.5 h-8 text-xs"
    >
      {copied ? (
        <>
          <Check className="size-3.5 text-emerald-500" /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" /> Copy {label}
        </>
      )}
    </Button>
  );
}

function TitleCard({ title }: { title: string }) {
  const charCount = title.length;
  const pct = (charCount / TITLE_MAX) * 100;
  const tone =
    pct > 100 ? "rose" : pct >= 80 ? "emerald" : pct >= 50 ? "amber" : "muted";

  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading icon={Type} label="Title" />
          <CopyButton value={title} label="title" />
        </div>
        <p className="text-base sm:text-lg font-semibold leading-snug text-foreground break-words">
          {title}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all ${
                tone === "rose"
                  ? "bg-rose-500"
                  : tone === "emerald"
                    ? "bg-emerald-500"
                    : tone === "amber"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/40"
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p
            className={`text-[11px] font-semibold tabular-nums ${
              tone === "rose"
                ? "text-rose-600"
                : tone === "emerald"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : tone === "amber"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
            }`}
          >
            {charCount} / {TITLE_MAX}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TagsCard({ tags }: { tags: string[] }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  async function copyOne(tag: string, idx: number) {
    await navigator.clipboard.writeText(tag);
    setCopiedIdx(idx);
    toast.success(`Copied "${tag}"`);
    setTimeout(() => setCopiedIdx(null), 1500);
  }

  async function copyAll() {
    await navigator.clipboard.writeText(tags.join(", "));
    toast.success(`Copied all ${tags.length} tags`);
  }

  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading
            icon={Tags}
            label="Tags"
            sub={`${tags.length} / 13 · ≤20 chars each`}
          />
          <CopyButton value={tags.join(", ")} label="all tags" />
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag, idx) => {
            const isLong = tag.length > TAG_MAX;
            const copied = copiedIdx === idx;
            return (
              <button
                key={`${tag}-${idx}`}
                type="button"
                onClick={() => copyOne(tag, idx)}
                className={`group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ring-1 ${
                  isLong
                    ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-rose-300/50"
                    : copied
                      ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 ring-emerald-400/50"
                      : "bg-muted/60 hover:bg-muted text-foreground/90 ring-border"
                }`}
                title={`Click to copy "${tag}"`}
              >
                {copied ? (
                  <Check className="size-3 text-emerald-600" />
                ) : (
                  <Hash className="size-3 opacity-50" />
                )}
                <span>{tag}</span>
                <span className="text-[9px] opacity-60 tabular-nums ml-0.5">
                  {tag.length}
                </span>
              </button>
            );
          })}
          {tags.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No tags returned.
            </p>
          )}
        </div>
        <div className="mt-4 pt-3 border-t flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={copyAll}
            className="gap-1.5 h-8 text-xs"
          >
            <Copy className="size-3.5" />
            Copy all (comma-separated)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DescriptionCard({ description }: { description: string }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading
            icon={FileText}
            label="Description"
            sub={`${description.length} chars`}
          />
          <CopyButton value={description} label="description" />
        </div>
        <div className="rounded-lg bg-muted/30 dark:bg-muted/20 p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-[420px] overflow-y-auto">
          {description}
        </div>
      </CardContent>
    </Card>
  );
}

function MaterialsCard({ materials }: { materials: string[] }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading icon={Layers} label="Materials" />
          {materials.length > 0 && (
            <CopyButton value={materials.join(", ")} label="materials" />
          )}
        </div>
        {materials.length === 0 ? (
          <p className="text-xs text-muted-foreground">None suggested.</p>
        ) : (
          <ul className="space-y-1.5">
            {materials.map((m) => (
              <li
                key={m}
                className="text-[12px] text-foreground/85 flex items-center gap-2"
              >
                <span className="size-1 rounded-full bg-orange-500" />
                {m}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AltTextCard({ altText }: { altText: string }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading icon={ImageIcon} label="Image alt text" />
          {altText && <CopyButton value={altText} label="alt text" />}
        </div>
        {altText ? (
          <p className="text-[13px] leading-relaxed text-foreground/90 italic">
            &ldquo;{altText}&rdquo;
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No alt text generated.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AttributesCard({
  attributes,
}: {
  attributes: { name: string; value: string }[];
}) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading
            icon={ListChecks}
            label="Category attributes"
            sub={`${attributes.length} pre-filled`}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {attributes.map((a) => (
            <div
              key={`${a.name}-${a.value}`}
              className="rounded-lg border bg-muted/30 px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {a.name}
                </p>
                <p className="text-[13px] font-semibold text-foreground truncate mt-0.5">
                  {a.value}
                </p>
              </div>
              <CopyButton value={a.value} label={a.name} size="xs" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RationaleCard({
  rationale,
}: {
  rationale: GeneratedListing["rationale"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 group"
        >
          <SectionHeading
            icon={Lightbulb}
            label="Why this works"
            sub="Strategy notes from Autopilot"
          />
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {open && (
          <div className="mt-4 space-y-3">
            <RationaleRow label="Keyword focus" value={rationale.keywordFocus} />
            <RationaleRow label="Title strategy" value={rationale.titleStrategy} />
            <RationaleRow label="Audience hook" value={rationale.audienceHook} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RationaleRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p className="text-[12px] text-foreground/90 leading-relaxed">{value}</p>
    </div>
  );
}

function CompetitorCard({
  competitors,
}: {
  competitors: { rank: number; title: string; favorites: number }[];
}) {
  if (competitors.length === 0) return null;
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <SectionHeading
          icon={Crown}
          label="Top competitors"
          sub="What Autopilot was reading"
        />
        <ul className="mt-3 space-y-2">
          {competitors.map((c) => (
            <li
              key={c.rank}
              className="rounded-lg border bg-muted/30 px-3 py-2 flex items-start gap-3"
            >
              <div className="size-7 rounded-md bg-gradient-to-br from-orange-500/15 to-violet-500/15 ring-1 ring-orange-500/20 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400 tabular-nums">
                  #{c.rank}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-foreground/90 leading-snug line-clamp-2">
                  {c.title}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Heart className="size-2.5" />
                  <span className="tabular-nums">{c.favorites.toLocaleString()}</span>
                  <span>favorites</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="size-8 rounded-lg bg-muted/60 dark:bg-muted/40 flex items-center justify-center shrink-0">
        <Icon className="size-4 text-foreground/70" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">{label}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
