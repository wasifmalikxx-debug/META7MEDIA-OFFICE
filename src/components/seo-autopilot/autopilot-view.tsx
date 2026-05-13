"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  Wand2,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Ban,
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
  Ruler,
  Palette,
  DollarSign,
  Package,
  Truck,
  Settings as SettingsIcon,
  Eye,
  Box,
  ScrollText,
  X,
  Plus,
  Calendar,
  Hand,
} from "lucide-react";
import { toast } from "sonner";
import {
  SeoImageUploader,
  type UploadedImage,
} from "./image-uploader";

// ─── Types — mirror the API shape ────────────────────────────────────

interface ComplianceVerdict {
  verdict: "ALLOWED" | "REVIEW" | "BLOCKED";
  concerns: Array<{
    severity: "block" | "warn";
    category: "trademark" | "prohibited" | "counterfeit" | "policy" | "quality";
    details: string;
  }>;
  summary: string;
}

interface GeneratedListing {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  attributes: { name: string; value: string }[];
  altTexts: string[];
  personalizationInstructions: string;
  suggestedType: "physical" | "digital";
  suggestedWhoMadeIt: "i_did" | "someone_else" | "collective";
  suggestedWhatIsIt: "finished_product" | "supply";
  suggestedWhenMade: string;
  rationale: {
    keywordFocus: string;
    titleStrategy: string;
    audienceHook: string;
  };
}

interface TextCompliance {
  ok: boolean;
  issues: Array<{ severity: "warn" | "block"; field: string; message: string }>;
}

type TagTier = "niche" | "moderate" | "hot" | "saturated";

interface TagDemand {
  tag: string;
  totalListings: number;
  topFavorites: number[];
  avgTopFavorites: number;
  demandScore: number;
  tier: TagTier;
  error?: string;
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

interface UserInputsEcho {
  sizes: string[];
  colors: string[];
  hasPersonalization: boolean;
  personalizationOptions: string;
  price: number | null;
  quantity: number | null;
  sku: string;
  processingDays: string;
  returnsPolicy: string;
}

interface GenerateResponse {
  compliance: ComplianceVerdict;
  listing: GeneratedListing | null;
  research: ResearchSummary;
  textCompliance: TextCompliance | null;
  tagIntelligence?: TagDemand[];
  inputs?: UserInputsEcho;
  generatedAt: string;
}

// ─── Etsy hard limits ────────────────────────────────────────────────

const TITLE_MAX = 140;
const TAG_MAX = 20;

// Human labels for the enum suggestions.
const WHO_MADE_LABEL = {
  i_did: "I did",
  someone_else: "Another company or person",
  collective: "A member of my Etsy shop",
} as const;
const WHAT_IS_IT_LABEL = {
  finished_product: "A finished product",
  supply: "A supply or tool to make things",
} as const;
const TYPE_LABEL = { physical: "Physical item", digital: "Digital files" } as const;

// ─── Main component ──────────────────────────────────────────────────

export function SeoAutopilotView() {
  // ─── Form state ───────────────────────────────────────────────────
  const [aliTitle, setAliTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);

  // Variations
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [hasPersonalization, setHasPersonalization] = useState(false);
  const [personalizationOptions, setPersonalizationOptions] = useState("");

  // Pricing & inventory
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sku, setSku] = useState("");

  // Production / delivery
  const [whoMadeIt, setWhoMadeIt] = useState<
    "i_did" | "someone_else" | "collective" | ""
  >("");
  const [whatIsIt, setWhatIsIt] = useState<"finished_product" | "supply" | "">("");
  const [whenMade, setWhenMade] = useState("");
  const [processingDays, setProcessingDays] = useState("");
  const [returnsPolicy, setReturnsPolicy] = useState("");

  // Section open/closed state
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({
    variations: false,
    pricing: false,
    production: false,
  });

  // ─── Generation state ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "reading" | "auditing-images" | "researching" | "writing" | "auditing-text"
  >("idle");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const titleValid = aliTitle.trim().length >= 8;
  const canSubmit = titleValid && !generating;

  async function handleGenerate() {
    if (!canSubmit) return;
    setGenerating(true);
    setErrorMsg(null);
    setResult(null);
    setStage("reading");

    // Fake progressive stage timer — server is opaque to client.
    const t1 = setTimeout(() => setStage("auditing-images"), 1500);
    const t2 = setTimeout(() => setStage("researching"), 5500);
    const t3 = setTimeout(() => setStage("writing"), 9500);
    const t4 = setTimeout(() => setStage("auditing-text"), 22000);

    try {
      const priceNum = price.trim() ? parseFloat(price) : null;
      const qtyNum = quantity.trim() ? parseInt(quantity, 10) : null;

      const res = await fetch("/api/seo-autopilot/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aliExpressTitle: aliTitle.trim(),
          notes: notes.trim() || null,
          images: images.map((i) => ({
            base64: i.base64,
            mediaType: i.mediaType,
          })),
          sizes,
          colors,
          hasPersonalization,
          personalizationOptions: personalizationOptions.trim() || null,
          price: Number.isFinite(priceNum) ? priceNum : null,
          quantity: Number.isFinite(qtyNum) ? qtyNum : null,
          sku: sku.trim() || null,
          whoMadeIt: whoMadeIt || null,
          whatIsIt: whatIsIt || null,
          whenMade: whenMade.trim() || null,
          processingDays: processingDays.trim() || null,
          returnsPolicy: returnsPolicy.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Generation failed (${res.status})`);
      }

      const data = (await res.json()) as GenerateResponse;
      setResult(data);
      setStage("idle");

      if (data.compliance.verdict === "BLOCKED") {
        toast.error("Product blocked", {
          description: data.compliance.summary,
        });
      } else if (data.compliance.verdict === "REVIEW") {
        toast.warning("Listing ready (with warnings)", {
          description: data.compliance.summary,
        });
      } else {
        toast.success("Listing ready", {
          description: data.research?.categoryPath
            ? `Picked category: ${data.research.categoryPath}`
            : "Cleared for Etsy.",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setErrorMsg(message);
      toast.error("Generation failed", { description: message });
      setStage("idle");
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      setGenerating(false);
    }
  }

  function handleReset() {
    setAliTitle("");
    setNotes("");
    setImages([]);
    setSizes([]);
    setColors([]);
    setHasPersonalization(false);
    setPersonalizationOptions("");
    setPrice("");
    setQuantity("");
    setSku("");
    setWhoMadeIt("");
    setWhatIsIt("");
    setWhenMade("");
    setProcessingDays("");
    setReturnsPolicy("");
    setResult(null);
    setErrorMsg(null);
  }

  function toggleSection(key: string) {
    setOpenSection((s) => ({ ...s, [key]: !s[key] }));
  }

  return (
    <div className="space-y-6">
      <HeroBanner />

      {/* ───────── Source (always open, required) ───────── */}
      <Card className="border shadow-none overflow-hidden">
        <CardContent className="p-5 sm:p-6 space-y-5">
          <SectionTitle
            n={1}
            label="Source"
            sub="Required"
            icon={Type}
            tone="orange"
          />

          <div className="space-y-2">
            <FieldLabel icon={Type}>Paste AliExpress title *</FieldLabel>
            <Textarea
              value={aliTitle}
              onChange={(e) => setAliTitle(e.target.value)}
              placeholder="ROSES Pearl Gorgeous Prom Dress Sweetheart Off the Shoulder Hollow Prom Gown with Fishbone Shiny Sequins Formal Gown Customized"
              className="min-h-[88px] resize-none text-sm"
              disabled={generating}
            />
            <p className="text-[10px] text-muted-foreground/80 leading-snug flex justify-between">
              <span>
                Autopilot reads this to figure out the Etsy keyword, category,
                and style.
              </span>
              <span className="tabular-nums">{aliTitle.length} chars</span>
            </p>
          </div>

          <div className="space-y-2">
            <FieldLabel icon={Lightbulb} optional>
              Anything to highlight?
            </FieldLabel>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Sweetheart neckline · Boned bodice · Hand-beaded details · Made-to-measure"
              className="min-h-[60px] resize-none text-sm"
              disabled={generating}
            />
          </div>

          <div className="space-y-2">
            <FieldLabel icon={ImageIcon} optional>
              Product images (2 recommended)
            </FieldLabel>
            <SeoImageUploader
              images={images}
              onChange={setImages}
              disabled={generating}
            />
            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              Upload your Nano Banana regenerated images — never raw AliExpress
              files (they have watermarks). Used for compliance check + better
              attribute accuracy.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ───────── Variations & options (collapsible) ───────── */}
      <CollapsibleCard
        open={openSection.variations}
        onToggle={() => toggleSection("variations")}
        n={2}
        label="Variations & options"
        sub="Sizes, colors, personalization"
        icon={Box}
      >
        <ChipInput
          label="Available sizes"
          icon={Ruler}
          values={sizes}
          onChange={setSizes}
          placeholder="XS, S, M, L, XL"
          suggestions={["XS", "S", "M", "L", "XL", "XXL", "One Size"]}
          disabled={generating}
        />
        <ChipInput
          label="Available colors"
          icon={Palette}
          values={colors}
          onChange={setColors}
          placeholder="black, white, ivory, blush"
          disabled={generating}
        />
        <div className="space-y-2">
          <FieldLabel icon={Hand}>Personalization</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton
              active={!hasPersonalization}
              onClick={() => setHasPersonalization(false)}
              label="No"
              sub="Standard listing"
              disabled={generating}
            />
            <ToggleButton
              active={hasPersonalization}
              onClick={() => setHasPersonalization(true)}
              label="Yes"
              sub="Buyer adds custom info"
              disabled={generating}
            />
          </div>
          {hasPersonalization && (
            <Textarea
              value={personalizationOptions}
              onChange={(e) => setPersonalizationOptions(e.target.value)}
              placeholder="What can buyers customize? E.g. 'name to be engraved, max 12 characters' or 'date for wedding'"
              className="min-h-[60px] resize-none text-sm mt-2"
              disabled={generating}
            />
          )}
        </div>
      </CollapsibleCard>

      {/* ───────── Pricing & inventory (collapsible) ───────── */}
      <CollapsibleCard
        open={openSection.pricing}
        onToggle={() => toggleSection("pricing")}
        n={3}
        label="Pricing & inventory"
        sub="Optional reference values"
        icon={DollarSign}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <FieldLabel icon={DollarSign}>Price (USD)</FieldLabel>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="24.99"
              className="text-sm"
              disabled={generating}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel icon={Package}>Quantity</FieldLabel>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="100"
              className="text-sm"
              disabled={generating}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <FieldLabel icon={Hash}>SKU</FieldLabel>
          <Input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="DRESS-OFF-001"
            className="text-sm"
            disabled={generating}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          These values are echoed back in the result so you can copy them
          straight into Etsy. They don&apos;t affect AI generation.
        </p>
      </CollapsibleCard>

      {/* ───────── Production & delivery (collapsible) ───────── */}
      <CollapsibleCard
        open={openSection.production}
        onToggle={() => toggleSection("production")}
        n={4}
        label="Production & delivery"
        sub="Who made it, when, processing time"
        icon={Truck}
      >
        <div className="space-y-1.5">
          <FieldLabel icon={Hand}>Who made it?</FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            <ToggleButton
              active={whoMadeIt === "i_did"}
              onClick={() => setWhoMadeIt("i_did")}
              label="I did"
              sub="Solo seller"
              disabled={generating}
            />
            <ToggleButton
              active={whoMadeIt === "collective"}
              onClick={() => setWhoMadeIt("collective")}
              label="Shop member"
              sub="Etsy team"
              disabled={generating}
            />
            <ToggleButton
              active={whoMadeIt === "someone_else"}
              onClick={() => setWhoMadeIt("someone_else")}
              label="Someone else"
              sub="3rd party"
              disabled={generating}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <FieldLabel icon={Box}>What is it?</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton
              active={whatIsIt === "finished_product"}
              onClick={() => setWhatIsIt("finished_product")}
              label="Finished product"
              sub="Ready to sell"
              disabled={generating}
            />
            <ToggleButton
              active={whatIsIt === "supply"}
              onClick={() => setWhatIsIt("supply")}
              label="Supply / tool"
              sub="For other makers"
              disabled={generating}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <FieldLabel icon={Calendar}>When was it made?</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton
              active={whenMade === "made_to_order"}
              onClick={() => setWhenMade("made_to_order")}
              label="Made to order"
              sub="Per buyer"
              disabled={generating}
            />
            <ToggleButton
              active={whenMade === "2020_2026"}
              onClick={() => setWhenMade("2020_2026")}
              label="2020-2026"
              sub="Current"
              disabled={generating}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <FieldLabel icon={Truck}>Processing time</FieldLabel>
            <Input
              value={processingDays}
              onChange={(e) => setProcessingDays(e.target.value)}
              placeholder="1-3 business days"
              className="text-sm"
              disabled={generating}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel icon={RotateCw}>Returns policy</FieldLabel>
            <Input
              value={returnsPolicy}
              onChange={(e) => setReturnsPolicy(e.target.value)}
              placeholder="30-day returns accepted"
              className="text-sm"
              disabled={generating}
            />
          </div>
        </div>
      </CollapsibleCard>

      {/* ───────── Generate button ───────── */}
      <div className="space-y-2">
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={!canSubmit}
          className="w-full h-14 gap-2 bg-gradient-to-r from-[#F1641E] via-orange-500 to-violet-600 text-white font-semibold text-sm shadow-lg shadow-orange-500/20 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              Generating
            </>
          ) : (
            <>
              <Wand2 className="size-5" />
              Generate Etsy listing
            </>
          )}
        </Button>
        {(aliTitle || notes || images.length > 0) && !generating && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="w-full text-xs"
          >
            <RotateCw className="size-3" />
            Reset everything
          </Button>
        )}
        {!titleValid && aliTitle.length > 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 text-center">
            Paste at least 8 characters of title text.
          </p>
        )}
      </div>

      {/* ───────── Output ───────── */}
      <div>
        {generating && <GeneratingPanel stage={stage} hasImages={images.length > 0} />}
        {errorMsg && !generating && <ErrorPanel message={errorMsg} />}
        {!generating && !result && !errorMsg && <EmptyPanel hasImages={images.length > 0} />}
        {!generating && result && <ResultPanel data={result} userImages={images} />}
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
              Vision · Claude + Etsy
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white/90 tracking-wider uppercase bg-black/15 backdrop-blur-sm px-2 py-0.5 rounded-full">
              <ShieldCheck className="size-3" />
              Strict compliance gate
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-tight">
            SEO Autopilot
          </h2>
          <p className="text-[12px] sm:text-sm text-white/85 mt-1 leading-snug max-w-2xl">
            Paste an AliExpress title, drop in your regenerated product photos,
            click Generate. Autopilot checks the product is allowed on Etsy
            then writes the{" "}
            <span className="underline decoration-white/70 decoration-2 underline-offset-[3px] font-semibold">
              complete listing
            </span>{" "}
            — title, tags, description, materials, and every category attribute.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable bits ──────────────────────────────────────────────────

function SectionTitle({
  n,
  label,
  sub,
  icon: Icon,
  tone = "muted",
}: {
  n: number;
  label: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "orange" | "muted";
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={`size-8 rounded-lg flex items-center justify-center font-bold text-xs tabular-nums ${
            tone === "orange"
              ? "bg-gradient-to-br from-orange-500 to-violet-600 text-white shadow shadow-orange-500/30"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {n}
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">{label}</p>
          {sub && (
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
              {sub}
            </p>
          )}
        </div>
      </div>
      <div className="size-7 rounded-lg bg-muted/40 flex items-center justify-center">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

function CollapsibleCard({
  open,
  onToggle,
  n,
  label,
  sub,
  icon: Icon,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  n: number;
  label: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card className="border shadow-none overflow-hidden">
      <CardContent className="p-5 sm:p-6 space-y-4">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center font-bold text-xs tabular-nums">
              {n}
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold tracking-tight">{label}</p>
              {sub && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {sub}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-muted/40 flex items-center justify-center">
              <Icon className="size-3.5 text-muted-foreground" />
            </div>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </div>
        </button>
        {open && <div className="space-y-4 pt-1">{children}</div>}
      </CardContent>
    </Card>
  );
}

function FieldLabel({
  children,
  icon: Icon,
  optional,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  optional?: boolean;
}) {
  return (
    <label className="text-[11px] font-semibold text-foreground/80 uppercase tracking-[0.14em] flex items-center gap-1.5">
      {Icon && <Icon className="size-3" />}
      {children}
      {optional && (
        <span className="text-[9px] font-normal text-muted-foreground normal-case tracking-normal ml-1">
          (optional)
        </span>
      )}
    </label>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  sub,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-orange-500/60 bg-orange-50 dark:bg-orange-950/30 ring-1 ring-orange-500/30"
          : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <p
        className={`text-xs font-semibold leading-tight ${
          active ? "text-orange-700 dark:text-orange-300" : "text-foreground"
        }`}
      >
        {label}
      </p>
      {sub && (
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
          {sub}
        </p>
      )}
    </button>
  );
}

function ChipInput({
  label,
  icon: Icon,
  values,
  onChange,
  placeholder,
  suggestions,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const tokens = raw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const t of tokens) {
      if (!set.has(t.toLowerCase()) && next.length < 30) {
        next.push(t);
        set.add(t.toLowerCase());
      }
    }
    onChange(next);
    setDraft("");
  }

  function removeAt(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-1.5">
      <FieldLabel icon={Icon} optional>
        {label}
      </FieldLabel>
      <div className="rounded-lg border bg-card px-2 py-2 min-h-[42px] flex flex-wrap gap-1.5 items-center">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium"
          >
            {v}
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={disabled}
              className="hover:text-rose-500 disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && values.length > 0) {
              removeAt(values.length - 1);
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={values.length === 0 ? placeholder : ""}
          disabled={disabled}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-muted-foreground/60"
        />
      </div>
      {suggestions && suggestions.length > 0 && values.length === 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-full bg-muted/40 hover:bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors disabled:opacity-50"
            >
              <Plus className="size-2.5" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Output states ─────────────────────────────────────────────────

function EmptyPanel({ hasImages }: { hasImages: boolean }) {
  return (
    <Card className="border-dashed border-2 shadow-none">
      <CardContent className="py-12 px-6 text-center">
        <div className="inline-flex size-14 rounded-2xl bg-gradient-to-br from-orange-500/15 to-violet-500/15 ring-1 ring-orange-500/20 items-center justify-center mb-4">
          <Sparkles className="size-7 text-orange-500" />
        </div>
        <h3 className="text-base font-semibold tracking-tight">
          Ready when you are
        </h3>
        <p className="text-[12px] text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
          {hasImages
            ? "Looking good — images are loaded. Click Generate to start the compliance check."
            : "Paste the AliExpress title above. Adding 2 regenerated product images unlocks the strict visual compliance check."}
        </p>
        <div className="mt-5 grid grid-cols-5 gap-2 max-w-2xl mx-auto">
          <EmptyPill icon={Type} label="Read" sub="Haiku" />
          <EmptyPill icon={Eye} label="Audit" sub="Vision" tone="orange" />
          <EmptyPill icon={TrendingUp} label="Research" sub="Etsy" />
          <EmptyPill icon={Wand2} label="Write" sub="Sonnet" tone="orange" />
          <EmptyPill icon={ShieldCheck} label="Verify" sub="Haiku" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyPill({
  icon: Icon,
  label,
  sub,
  tone = "muted",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  tone?: "orange" | "muted";
}) {
  return (
    <div
      className={`rounded-lg border px-2 py-2 text-center ${
        tone === "orange"
          ? "bg-orange-50/50 dark:bg-orange-950/20 border-orange-300/40"
          : "bg-muted/30"
      }`}
    >
      <Icon
        className={`size-3.5 mx-auto ${
          tone === "orange" ? "text-orange-500" : "text-muted-foreground"
        }`}
      />
      <p className="text-[11px] font-semibold mt-1">{label}</p>
      <p className="text-[9px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function GeneratingPanel({
  stage,
  hasImages,
}: {
  stage:
    | "idle"
    | "reading"
    | "auditing-images"
    | "researching"
    | "writing"
    | "auditing-text";
  hasImages: boolean;
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
              Usually 20-40 seconds with images.
            </p>
          </div>

          <div className="space-y-2.5">
            <StageRow
              label="Reading your AliExpress title"
              status={stageStatus(stage, "reading")}
            />
            <StageRow
              label={
                hasImages
                  ? "Auditing the product for Etsy compliance"
                  : "Auditing the title for Etsy compliance"
              }
              status={stageStatus(stage, "auditing-images")}
            />
            <StageRow
              label="Researching live Etsy ranking data"
              status={stageStatus(stage, "researching")}
            />
            <StageRow
              label="Writing your complete Etsy listing"
              status={stageStatus(stage, "writing")}
            />
            <StageRow
              label="Final text rule check"
              status={stageStatus(stage, "auditing-text")}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type Stage =
  | "idle"
  | "reading"
  | "auditing-images"
  | "researching"
  | "writing"
  | "auditing-text";
type StageStatus = "pending" | "active" | "done";
const STAGE_ORDER = [
  "reading",
  "auditing-images",
  "researching",
  "writing",
  "auditing-text",
] as const;
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
          status === "done" || status === "active"
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

function ResultPanel({
  data,
  userImages,
}: {
  data: GenerateResponse;
  userImages: UploadedImage[];
}) {
  const { compliance, listing, research, textCompliance, inputs } = data;

  // BLOCKED — short-circuit, show only the compliance verdict.
  if (compliance.verdict === "BLOCKED" || !listing) {
    return <BlockedPanel verdict={compliance} />;
  }

  return (
    <div className="space-y-4">
      <ComplianceCard verdict={compliance} />
      <ResearchStrip research={research} />
      {textCompliance && <TextComplianceBanner report={textCompliance} />}

      {/* ─── Etsy section: Category ─── */}
      <EtsySectionGroup
        n={1}
        title="Category"
        icon={Layers}
        sub="Paste into Etsy's category picker"
      >
        <FieldCard
          label="Category path"
          value={research.categoryPath}
          icon={Layers}
        />
        <FieldRow
          label="Item type"
          value={TYPE_LABEL[listing.suggestedType]}
          icon={Box}
          hint="Etsy form: 'What type of item is it?'"
        />
        <FieldRow
          label="When was it made"
          value={whenMadeLabel(listing.suggestedWhenMade)}
          icon={Calendar}
          hint="Etsy form: 'When was it made?'"
        />
      </EtsySectionGroup>

      {/* ─── Etsy section: Item details ─── */}
      <EtsySectionGroup n={2} title="Item details" icon={FileText}>
        <TitleCard title={listing.title} />
        <DescriptionCard description={listing.description} />
      </EtsySectionGroup>

      {/* ─── Etsy section: Item options ─── */}
      {(inputs?.sizes.length || inputs?.colors.length || listing.personalizationInstructions) && (
        <EtsySectionGroup n={3} title="Item options" icon={Box}>
          {(inputs?.sizes.length || inputs?.colors.length) && (
            <VariationsCard sizes={inputs?.sizes ?? []} colors={inputs?.colors ?? []} />
          )}
          {listing.personalizationInstructions && (
            <PersonalizationCard
              instructions={listing.personalizationInstructions}
            />
          )}
        </EtsySectionGroup>
      )}

      {/* ─── Etsy section: Attributes ─── */}
      <EtsySectionGroup n={4} title="Attributes" icon={Tags}>
        <TagsCard tags={listing.tags} intelligence={data.tagIntelligence ?? []} />
        {data.tagIntelligence && data.tagIntelligence.length > 0 && (
          <TagIntelligenceCard intelligence={data.tagIntelligence} />
        )}
        <MaterialsCard materials={listing.materials} />
        {listing.attributes.length > 0 && (
          <AttributesCard attributes={listing.attributes} />
        )}
      </EtsySectionGroup>

      {/* ─── Etsy section: Pricing & inventory ─── */}
      {(inputs?.price || inputs?.quantity || inputs?.sku) && (
        <EtsySectionGroup n={5} title="Price and inventory" icon={DollarSign}>
          <PricingCard inputs={inputs} />
        </EtsySectionGroup>
      )}

      {/* ─── Etsy section: Delivery ─── */}
      {(inputs?.processingDays || inputs?.returnsPolicy) && (
        <EtsySectionGroup
          n={6}
          title="Delivery, processing and returns"
          icon={Truck}
        >
          <DeliveryCard inputs={inputs} />
        </EtsySectionGroup>
      )}

      {/* ─── Etsy section: Image alt text ─── */}
      <EtsySectionGroup n={7} title="Image alt text" icon={ImageIcon}>
        <AltTextsCard altTexts={listing.altTexts} userImages={userImages} />
      </EtsySectionGroup>

      {/* ─── Etsy section: How it's made ─── */}
      <EtsySectionGroup n={8} title="How it's made" icon={Hand}>
        <FieldRow
          label="Who made it"
          value={WHO_MADE_LABEL[listing.suggestedWhoMadeIt]}
          icon={Hand}
          hint="Etsy form: 'Who made it?'"
        />
        <FieldRow
          label="What is it"
          value={WHAT_IS_IT_LABEL[listing.suggestedWhatIsIt]}
          icon={Box}
          hint="Etsy form: 'What is it?'"
        />
      </EtsySectionGroup>

      {/* ─── Etsy section: Settings ─── */}
      <EtsySectionGroup n={9} title="Settings" icon={SettingsIcon}>
        <FieldRow
          label="Renewal options"
          value="Automatic"
          icon={RotateCw}
          hint="Etsy form: 'Renewal options'"
        />
      </EtsySectionGroup>

      <RationaleCard rationale={listing.rationale} />
      <CompetitorCard competitors={research.topCompetitors} />
    </div>
  );
}

// ─── Result sub-components ──────────────────────────────────────────

function whenMadeLabel(v: string): string {
  if (v === "made_to_order") return "Made to order";
  if (v === "2020_2026") return "2020-2026";
  if (v === "2010_2019") return "2010-2019";
  if (v === "2000_2009") return "2000-2009";
  return v;
}

function ComplianceCard({ verdict }: { verdict: ComplianceVerdict }) {
  if (verdict.verdict === "ALLOWED" && verdict.concerns.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-300/50 dark:border-emerald-700/40 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 flex items-center gap-3">
        <div className="size-9 rounded-lg bg-emerald-500/20 ring-1 ring-emerald-500/30 flex items-center justify-center shrink-0">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
            Product cleared for Etsy listing
          </p>
          <p className="text-[12px] text-foreground/80 mt-0.5 leading-snug">
            {verdict.summary || "No trademark, IP, or prohibited content detected."}
          </p>
        </div>
      </div>
    );
  }
  // REVIEW
  return (
    <div className="rounded-xl border border-amber-300/50 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-amber-500/20 ring-1 ring-amber-500/30 flex items-center justify-center shrink-0">
          <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
            Listing generated — review carefully
          </p>
          <p className="text-[12px] text-foreground/80 mt-0.5 leading-snug">
            {verdict.summary}
          </p>
        </div>
      </div>
      <ul className="space-y-1.5 pl-1">
        {verdict.concerns.map((c, i) => (
          <li key={i} className="text-[12px] flex gap-2 items-start">
            <span className="mt-1 size-1.5 rounded-full bg-amber-500 shrink-0" />
            <span>
              <span className="font-semibold uppercase text-[10px] tracking-wider mr-1.5 opacity-70">
                {c.category}
              </span>
              {c.details}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockedPanel({ verdict }: { verdict: ComplianceVerdict }) {
  return (
    <div className="rounded-xl border-2 border-rose-400 dark:border-rose-700 bg-rose-50/80 dark:bg-rose-950/40 p-5 sm:p-6 space-y-4 shadow-lg shadow-rose-500/10">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-xl bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0">
          <Ban className="size-6 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.18em]">
            Compliance · Blocked
          </p>
          <h3 className="text-lg sm:text-xl font-bold text-rose-900 dark:text-rose-200 leading-tight">
            Do NOT list this on Etsy
          </h3>
        </div>
      </div>

      <div className="rounded-lg bg-card border border-rose-200 dark:border-rose-900/40 p-4">
        <p className="text-sm text-foreground leading-relaxed">{verdict.summary}</p>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-rose-700 dark:text-rose-300 uppercase tracking-[0.16em]">
          Specific concerns
        </p>
        <ul className="space-y-2">
          {verdict.concerns.map((c, i) => (
            <li
              key={i}
              className="rounded-lg bg-card border px-3 py-2 flex items-start gap-3"
            >
              <span
                className={`mt-1.5 size-2 rounded-full shrink-0 ${
                  c.severity === "block" ? "bg-rose-500" : "bg-amber-500"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-0.5">
                  {c.category} · {c.severity}
                </p>
                <p className="text-[12px] leading-relaxed">{c.details}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg bg-rose-100/60 dark:bg-rose-900/20 border border-rose-300/50 dark:border-rose-700/40 px-3 py-2.5">
        <p className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
          <span className="font-bold">Why this matters:</span> Etsy can remove
          listings that violate IP / policy within hours and may issue a strike
          against the shop. Source a different (non-IP) version of this product
          or pick a different one to list.
        </p>
      </div>
    </div>
  );
}

function TextComplianceBanner({ report }: { report: TextCompliance }) {
  if (report.ok && report.issues.length === 0) return null;
  const blocks = report.issues.filter((i) => i.severity === "block");
  const warns = report.issues.filter((i) => i.severity === "warn");
  if (blocks.length === 0 && warns.length === 0) return null;
  const tone = blocks.length > 0 ? "rose" : "amber";
  return (
    <div
      className={`rounded-xl border ${
        tone === "rose"
          ? "border-rose-300/50 dark:border-rose-700/40 bg-rose-50/60 dark:bg-rose-950/20"
          : "border-amber-300/50 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-950/20"
      } p-3 space-y-2`}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-wider ${
          tone === "rose"
            ? "text-rose-700 dark:text-rose-300"
            : "text-amber-700 dark:text-amber-300"
        }`}
      >
        Text rule check · {blocks.length} blocker · {warns.length} warning
      </p>
      <ul className="space-y-1">
        {[...blocks, ...warns].map((iss, idx) => (
          <li key={idx} className="text-[12px] flex gap-2 items-start">
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

function ResearchStrip({ research }: { research: ResearchSummary }) {
  return (
    <Card className="border shadow-none overflow-hidden relative">
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
            icon={Target}
            label="Searched Etsy for"
            value={research.searchKeyword}
          />
          <DecisionRow
            icon={Layers}
            label="Picked category"
            value={research.categoryPath}
          />
          <DecisionRow
            icon={Box}
            label="Product type"
            value={research.productType}
          />
          <DecisionRow
            icon={Crown}
            label="Data analyzed"
            value={`${research.competitorsAnalyzed} ranking · ${research.attributesAvailable} attrs`}
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

function EtsySectionGroup({
  n,
  title,
  icon: Icon,
  sub,
  children,
}: {
  n: number;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2.5 px-1">
        <div className="size-6 rounded-md bg-gradient-to-br from-orange-500/15 to-violet-500/15 ring-1 ring-orange-500/20 flex items-center justify-center">
          <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 tabular-nums">
            {n}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-foreground/70 uppercase tracking-[0.18em]">
            Etsy section · {title}
          </p>
          {sub && (
            <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>
          )}
        </div>
        <div className="ml-auto size-6 rounded-md bg-muted/40 flex items-center justify-center">
          <Icon className="size-3 text-muted-foreground" />
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
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

function FieldCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="size-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          <p className="text-sm font-semibold text-foreground truncate">
            {value || "—"}
          </p>
        </div>
        {value && <CopyButton value={value} label={label.toLowerCase()} />}
      </CardContent>
    </Card>
  );
}

function FieldRow({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 flex items-center gap-3">
      <Icon className="size-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
          {label}
        </p>
        <p className="text-sm font-semibold text-foreground leading-tight mt-0.5">
          {value}
        </p>
        {hint && (
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">{hint}</p>
        )}
      </div>
      <CopyButton value={value} label={label.toLowerCase()} size="xs" />
    </div>
  );
}

function TitleCard({ title }: { title: string }) {
  const charCount = title.length;
  const pct = (charCount / TITLE_MAX) * 100;
  const tone =
    pct > 100 ? "rose" : pct >= 80 ? "emerald" : pct >= 50 ? "amber" : "muted";

  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
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

function TagsCard({
  tags,
  intelligence,
}: {
  tags: string[];
  intelligence: TagDemand[];
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const intelByTag = new Map(intelligence.map((i) => [i.tag, i]));

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

  const hasIntel = intelligence.length > 0;

  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading
            icon={Tags}
            label="Tags"
            sub={
              hasIntel
                ? `${tags.length} / 13 · live demand data from Etsy`
                : `${tags.length} / 13 · ≤20 chars each`
            }
          />
          <CopyButton value={tags.join(", ")} label="all tags" />
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag, idx) => {
            const isLong = tag.length > TAG_MAX;
            const copied = copiedIdx === idx;
            const intel = intelByTag.get(tag);
            return (
              <button
                key={`${tag}-${idx}`}
                type="button"
                onClick={() => copyOne(tag, idx)}
                className={`group inline-flex items-center gap-1.5 rounded-full pl-3 pr-1.5 py-1 text-[12px] font-medium transition-all ring-1 ${
                  isLong
                    ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-rose-300/50"
                    : copied
                      ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 ring-emerald-400/50"
                      : "bg-muted/60 hover:bg-muted text-foreground/90 ring-border"
                }`}
                title={
                  intel
                    ? `${tag} · ${formatCount(intel.totalListings)} listings · avg ${intel.avgTopFavorites} favs · ${TIER_LABEL[intel.tier]}`
                    : `Click to copy "${tag}"`
                }
              >
                {copied ? (
                  <Check className="size-3 text-emerald-600" />
                ) : (
                  <Hash className="size-3 opacity-50" />
                )}
                <span>{tag}</span>
                <span className="text-[9px] opacity-50 tabular-nums">
                  {tag.length}
                </span>
                {intel && (
                  <span
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums ring-1 ${TIER_STYLE[intel.tier]}`}
                  >
                    <span>{TIER_GLYPH[intel.tier]}</span>
                    <span>{formatCount(intel.totalListings)}</span>
                  </span>
                )}
              </button>
            );
          })}
          {tags.length === 0 && (
            <p className="text-xs text-muted-foreground">No tags returned.</p>
          )}
        </div>
        {hasIntel && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <LegendChip tier="niche" />
            <LegendChip tier="moderate" />
            <LegendChip tier="hot" />
            <LegendChip tier="saturated" />
          </div>
        )}
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

// ─── Tag intelligence helpers ───────────────────────────────────────

const TIER_LABEL: Record<TagTier, string> = {
  niche: "Niche — low competition",
  moderate: "Moderate demand",
  hot: "Hot — high demand",
  saturated: "Saturated market",
};

const TIER_GLYPH: Record<TagTier, string> = {
  niche: "🌱",
  moderate: "📊",
  hot: "🔥",
  saturated: "⚠️",
};

const TIER_STYLE: Record<TagTier, string> = {
  niche:
    "bg-sky-100 text-sky-700 ring-sky-300/50 dark:bg-sky-950/40 dark:text-sky-300",
  moderate:
    "bg-emerald-100 text-emerald-700 ring-emerald-300/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  hot: "bg-amber-100 text-amber-800 ring-amber-300/50 dark:bg-amber-950/40 dark:text-amber-300",
  saturated:
    "bg-rose-100 text-rose-700 ring-rose-300/50 dark:bg-rose-950/40 dark:text-rose-300",
};

const TIER_DESCRIPTION: Record<TagTier, string> = {
  niche: "<1k listings — easy to rank for, but low traffic",
  moderate: "1k-10k listings — sweet spot for most shops",
  hot: "10k-50k listings — high demand, high competition",
  saturated: ">50k listings — very hard to rank as a new shop",
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function LegendChip({ tier }: { tier: TagTier }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${TIER_STYLE[tier]}`}
    >
      <span>{TIER_GLYPH[tier]}</span>
      <span className="capitalize">{tier}</span>
    </span>
  );
}

function TagIntelligenceCard({
  intelligence,
}: {
  intelligence: TagDemand[];
}) {
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState<
    "tag" | "listings" | "favs" | "score"
  >("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "tag" ? "asc" : "desc");
    }
  }

  const sorted = [...intelligence].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "tag") return a.tag.localeCompare(b.tag) * dir;
    if (sortBy === "listings") return (a.totalListings - b.totalListings) * dir;
    if (sortBy === "favs")
      return (a.avgTopFavorites - b.avgTopFavorites) * dir;
    return (a.demandScore - b.demandScore) * dir;
  });

  // Summary chips
  const tierCounts = intelligence.reduce(
    (acc, t) => {
      acc[t.tier] = (acc[t.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<TagTier, number>,
  );

  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 group"
        >
          <SectionHeading
            icon={TrendingUp}
            label="Tag intelligence"
            sub={`${intelligence.length} tags analyzed · live Etsy demand data`}
          />
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1">
              {(["niche", "moderate", "hot", "saturated"] as TagTier[]).map(
                (t) =>
                  tierCounts[t] ? (
                    <span
                      key={t}
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${TIER_STYLE[t]}`}
                    >
                      <span>{TIER_GLYPH[t]}</span>
                      <span>{tierCounts[t]}</span>
                    </span>
                  ) : null,
              )}
            </div>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </div>
        </button>

        {open && (
          <div className="mt-4 space-y-3">
            {/* Legend */}
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {(["niche", "moderate", "hot", "saturated"] as TagTier[]).map(
                (t) => (
                  <div
                    key={t}
                    className="rounded-lg border bg-muted/20 px-2.5 py-1.5 flex items-center gap-2"
                  >
                    <span
                      className={`inline-flex items-center justify-center size-6 rounded-full text-[10px] ring-1 ${TIER_STYLE[t]}`}
                    >
                      {TIER_GLYPH[t]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold capitalize leading-tight">
                        {t}
                      </p>
                      <p className="text-[9px] text-muted-foreground leading-tight">
                        {TIER_DESCRIPTION[t]}
                      </p>
                    </div>
                  </div>
                ),
              )}
            </div>

            {/* Sortable table */}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <SortableTh
                      label="Tag"
                      active={sortBy === "tag"}
                      dir={sortDir}
                      onClick={() => toggleSort("tag")}
                      align="left"
                    />
                    <SortableTh
                      label="Tier"
                      active={false}
                      dir={sortDir}
                      onClick={() => {}}
                      align="left"
                      disabled
                    />
                    <SortableTh
                      label="Listings"
                      active={sortBy === "listings"}
                      dir={sortDir}
                      onClick={() => toggleSort("listings")}
                      align="right"
                    />
                    <SortableTh
                      label="Top avg favs"
                      active={sortBy === "favs"}
                      dir={sortDir}
                      onClick={() => toggleSort("favs")}
                      align="right"
                    />
                    <SortableTh
                      label="Demand"
                      active={sortBy === "score"}
                      dir={sortDir}
                      onClick={() => toggleSort("score")}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr
                      key={row.tag}
                      className="border-t hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2 font-medium text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Hash className="size-3 opacity-50" />
                          {row.tag}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${TIER_STYLE[row.tier]}`}
                        >
                          <span>{TIER_GLYPH[row.tier]}</span>
                          <span className="capitalize">{row.tier}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {row.error ? (
                          <span className="text-muted-foreground/40">—</span>
                        ) : (
                          formatCount(row.totalListings)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.error ? (
                          <span className="text-muted-foreground/40">—</span>
                        ) : (
                          row.avgTopFavorites.toLocaleString()
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DemandBar score={row.demandScore} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              Etsy doesn&apos;t share real search volume publicly. These
              numbers are live counts from{" "}
              <code className="text-[10px]">/listings/active</code> for each
              tag — a strong proxy for demand + competition.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align,
  disabled,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align: "left" | "right";
  disabled?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1 ${
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        } disabled:cursor-default disabled:hover:text-muted-foreground`}
      >
        {label}
        {active && (
          <ChevronDown
            className={`size-3 transition-transform ${dir === "asc" ? "rotate-180" : ""}`}
          />
        )}
      </button>
    </th>
  );
}

function DemandBar({ score }: { score: number }) {
  const tone =
    score >= 75
      ? "rose"
      : score >= 50
        ? "amber"
        : score >= 25
          ? "emerald"
          : "sky";
  return (
    <div className="inline-flex items-center gap-2 min-w-[80px] justify-end">
      <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full transition-all ${
            tone === "rose"
              ? "bg-rose-500"
              : tone === "amber"
                ? "bg-amber-500"
                : tone === "emerald"
                  ? "bg-emerald-500"
                  : "bg-sky-500"
          }`}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums font-semibold text-foreground/80 w-7 text-right">
        {score}
      </span>
    </div>
  );
}

function DescriptionCard({ description }: { description: string }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading
            icon={ScrollText}
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
  if (materials.length === 0) return null;
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading icon={Layers} label="Materials" />
          <CopyButton value={materials.join(", ")} label="materials" />
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {materials.map((m) => (
            <li
              key={m}
              className="text-[12px] text-foreground/85 flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5"
            >
              <span className="size-1 rounded-full bg-orange-500" />
              {m}
            </li>
          ))}
        </ul>
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
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading
            icon={ListChecks}
            label="Category attributes"
            sub={`${attributes.length} pre-filled · paste into matching Etsy field`}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {attributes.map((a, idx) => (
            <div
              key={`${a.name}-${idx}`}
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

function VariationsCard({
  sizes,
  colors,
}: {
  sizes: string[];
  colors: string[];
}) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 space-y-3">
        <SectionHeading
          icon={Box}
          label="Variations"
          sub="Your values — copy into Etsy's Variations setup"
        />
        {sizes.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Ruler className="size-3" /> Sizes ({sizes.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sizes.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium"
                >
                  {s}
                </span>
              ))}
              <CopyButton value={sizes.join(", ")} label="sizes" size="xs" />
            </div>
          </div>
        )}
        {colors.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Palette className="size-3" /> Colors ({colors.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {colors.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium"
                >
                  {c}
                </span>
              ))}
              <CopyButton value={colors.join(", ")} label="colors" size="xs" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PersonalizationCard({ instructions }: { instructions: string }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading
            icon={Hand}
            label="Personalization instructions"
            sub="Buyers see this when ordering"
          />
          <CopyButton value={instructions} label="instructions" />
        </div>
        <div className="rounded-lg bg-muted/30 p-3 text-[13px] leading-relaxed italic">
          &ldquo;{instructions}&rdquo;
        </div>
      </CardContent>
    </Card>
  );
}

function AltTextsCard({
  altTexts,
  userImages,
}: {
  altTexts: string[];
  userImages: UploadedImage[];
}) {
  if (altTexts.length === 0) return null;
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 space-y-3">
        <SectionHeading
          icon={ImageIcon}
          label="Image alt text"
          sub="One per image · paste into Etsy's image alt-text field"
        />
        <div className="space-y-2.5">
          {altTexts.map((alt, idx) => {
            const img = userImages[idx];
            return (
              <div
                key={idx}
                className="rounded-lg border bg-muted/20 p-3 flex gap-3 items-start"
              >
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.previewUrl}
                    alt=""
                    className="size-14 rounded-md object-cover shrink-0 ring-1 ring-border"
                  />
                ) : (
                  <div className="size-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon className="size-5 text-muted-foreground/40" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Image {idx + 1}
                    </p>
                    <CopyButton value={alt} label={`image ${idx + 1} alt`} size="xs" />
                  </div>
                  <p className="text-[12px] text-foreground/90 leading-relaxed italic">
                    &ldquo;{alt}&rdquo;
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PricingCard({ inputs }: { inputs: UserInputsEcho }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 grid gap-3 sm:grid-cols-3">
        {inputs.price != null && (
          <FieldRow
            label="Price"
            value={`$${inputs.price.toFixed(2)}`}
            icon={DollarSign}
          />
        )}
        {inputs.quantity != null && (
          <FieldRow
            label="Quantity"
            value={String(inputs.quantity)}
            icon={Package}
          />
        )}
        {inputs.sku && (
          <FieldRow label="SKU" value={inputs.sku} icon={Hash} />
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryCard({ inputs }: { inputs: UserInputsEcho }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 grid gap-3 sm:grid-cols-2">
        {inputs.processingDays && (
          <FieldRow
            label="Processing time"
            value={inputs.processingDays}
            icon={Truck}
          />
        )}
        {inputs.returnsPolicy && (
          <FieldRow
            label="Returns policy"
            value={inputs.returnsPolicy}
            icon={RotateCw}
          />
        )}
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
      <CardContent className="p-5">
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
      <CardContent className="p-5">
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
                  <span className="tabular-nums">
                    {c.favorites.toLocaleString()}
                  </span>
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
