"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sparkles,
  Wand2,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Ban,
  Hash,
  RotateCw,
  X,
  Plus,
  Heart,
  TrendingUp,
  ImageIcon,
  Shuffle,
} from "lucide-react";
import { toast } from "sonner";
import { SeoImageUploader, type UploadedImage } from "./image-uploader";

// ─── API response shape ─────────────────────────────────────────────

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
interface KeywordFrequency {
  phrase: string;
  count: number;
  percentage: number;
}
interface AnchorKeywords {
  topPhrases: KeywordFrequency[];
  topTags: KeywordFrequency[];
  totalListings: number;
}
interface BuyerKeywordScore {
  keyword: string;
  totalListings: number;
  avgTopFavorites: number;
  tier: TagTier;
  buyerScore: number; // 0-100
}

interface GenerateResponse {
  compliance: ComplianceVerdict;
  listing: GeneratedListing | null;
  research: ResearchSummary;
  anchorKeywords?: AnchorKeywords;
  buyerKeywords?: BuyerKeywordScore[];
  textCompliance: TextCompliance | null;
  tagIntelligence?: TagDemand[];
  inputs?: UserInputsEcho;
  generatedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────

const TITLE_MAX = 140;
const TAG_MAX = 20;

const WHO_MADE_LABEL = {
  i_did: "I did",
  someone_else: "Another company or person",
  collective: "A member of my Etsy shop",
} as const;
const WHAT_IS_IT_LABEL = {
  finished_product: "A finished product",
  supply: "A supply or tool to make things",
} as const;
const TYPE_LABEL = {
  physical: "Physical item",
  digital: "Digital files",
} as const;

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
  niche: "<1k listings — easy to rank, low traffic",
  moderate: "1k-10k listings — sweet spot for most shops",
  hot: "10k-50k listings — high demand, high competition",
  saturated: ">50k — very hard to rank as a new shop",
};

function whenMadeLabel(v: string): string {
  if (v === "made_to_order") return "Made to order";
  if (v === "2020_2026") return "2020-2026";
  if (v === "2010_2019") return "2010-2019";
  if (v === "2000_2009") return "2000-2009";
  return v;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ─── Main component ─────────────────────────────────────────────────

/**
 * SEO Autopilot — single-flow redesign (May 14 2026).
 *
 * Replaces the previous 4-section input + 9-section result with ONE
 * input card and ONE result card. Numbered steps in the input, clean
 * row-by-row fields in the result. Less colour, more typography. The
 * goal: an employee opens this and immediately knows what to do.
 *
 * Layout:
 *   - Brand header (one row)
 *   - Input card (steps 1, 2, optional 3 + CTA)
 *   - One of: progress / error / blocked / result + insights
 */
export function SeoAutopilotView() {
  // ─── Form state ───────────────────────────────────────────────────
  const [aliTitle, setAliTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Advanced
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [hasPersonalization, setHasPersonalization] = useState(false);
  const [personalizationOptions, setPersonalizationOptions] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sku, setSku] = useState("");
  const [whoMadeIt, setWhoMadeIt] = useState<
    "i_did" | "someone_else" | "collective" | ""
  >("");
  const [whatIsIt, setWhatIsIt] = useState<"finished_product" | "supply" | "">(
    "",
  );
  const [whenMade, setWhenMade] = useState("");
  const [processingDays, setProcessingDays] = useState("");
  const [returnsPolicy, setReturnsPolicy] = useState("");

  // ─── Generation state ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "reading" | "checking" | "researching" | "writing" | "auditing"
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

    const t1 = setTimeout(() => setStage("checking"), 1500);
    const t2 = setTimeout(() => setStage("researching"), 6000);
    const t3 = setTimeout(() => setStage("writing"), 10000);
    const t4 = setTimeout(() => setStage("auditing"), 25000);

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
        toast.error("Product blocked", { description: data.compliance.summary });
      } else if (data.compliance.verdict === "REVIEW") {
        toast.warning("Listing ready — review warnings", {
          description: data.compliance.summary,
        });
      } else {
        toast.success("Listing ready", {
          description: data.research.categoryPath || "Cleared for Etsy.",
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
    setShowAdvanced(false);
    setResult(null);
    setErrorMsg(null);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <BrandHeader />

      {/* ──────────────── INPUT ──────────────── */}
      <Card className="border shadow-none">
        <CardContent className="p-6 sm:p-7 space-y-7">
          {/* Step 1 */}
          <StepRow n={1} title="Paste your AliExpress title">
            <Textarea
              value={aliTitle}
              onChange={(e) => setAliTitle(e.target.value)}
              placeholder="ROSES Pearl Gorgeous Prom Dress Sweetheart Off the Shoulder Hollow Prom Gown..."
              className="min-h-[88px] resize-none text-sm"
              disabled={generating}
            />
            <Hint
              left="Autopilot reads this to figure out the keyword, category & audience."
              right={`${aliTitle.length} chars`}
            />
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional · anything to highlight (sweetheart neckline, made-to-measure, etc.)"
              className="min-h-[56px] resize-none text-sm bg-muted/20"
              disabled={generating}
            />
          </StepRow>

          {/* Step 2 */}
          <StepRow n={2} title="Upload your 2 product images">
            <SeoImageUploader
              images={images}
              onChange={setImages}
              disabled={generating}
            />
            <Hint left="Use your Nano Banana regenerated images — never raw AliExpress files (watermarks). The AI checks them for trademark / policy violations before writing." />
          </StepRow>

          {/* Step 3 (optional) */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              disabled={generating}
              className="w-full flex items-center justify-between gap-3 group disabled:opacity-50"
            >
              <StepLabel n={3}>
                Add details{" "}
                <span className="text-[10px] text-muted-foreground font-normal normal-case tracking-normal ml-1">
                  (optional — improves accuracy)
                </span>
              </StepLabel>
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform ${
                  showAdvanced ? "rotate-180" : ""
                }`}
              />
            </button>
            {showAdvanced && (
              <AdvancedFields
                sizes={sizes}
                setSizes={setSizes}
                colors={colors}
                setColors={setColors}
                hasPersonalization={hasPersonalization}
                setHasPersonalization={setHasPersonalization}
                personalizationOptions={personalizationOptions}
                setPersonalizationOptions={setPersonalizationOptions}
                price={price}
                setPrice={setPrice}
                quantity={quantity}
                setQuantity={setQuantity}
                sku={sku}
                setSku={setSku}
                whoMadeIt={whoMadeIt}
                setWhoMadeIt={setWhoMadeIt}
                whatIsIt={whatIsIt}
                setWhatIsIt={setWhatIsIt}
                whenMade={whenMade}
                setWhenMade={setWhenMade}
                processingDays={processingDays}
                setProcessingDays={setProcessingDays}
                returnsPolicy={returnsPolicy}
                setReturnsPolicy={setReturnsPolicy}
                disabled={generating}
              />
            )}
          </div>

          {/* CTA */}
          <div className="pt-2 border-t space-y-2">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!canSubmit}
              className="w-full h-12 gap-2 bg-gradient-to-r from-[#F1641E] to-orange-600 text-white font-semibold text-sm shadow-md shadow-orange-500/20 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Generating
                </>
              ) : (
                <>
                  <Wand2 className="size-4" /> Generate Etsy listing
                </>
              )}
            </Button>
            {(aliTitle || notes || images.length > 0) && !generating && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="w-full text-xs text-muted-foreground hover:text-foreground gap-1.5 h-8"
              >
                <RotateCw className="size-3" /> Reset
              </Button>
            )}
            {!titleValid && aliTitle.length > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center">
                Paste at least 8 characters of title text.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ──────────────── OUTPUT ──────────────── */}
      {generating && <ProgressCard stage={stage} />}
      {errorMsg && !generating && <ErrorCard message={errorMsg} />}
      {result && !generating && result.compliance.verdict === "BLOCKED" && (
        <BlockedCard verdict={result.compliance} />
      )}
      {result &&
        !generating &&
        result.compliance.verdict !== "BLOCKED" &&
        result.listing && (
          <>
            <ResultCard
              key={result.generatedAt}
              data={result}
              userImages={images}
            />
            <InsightsCard data={result} />
          </>
        )}
    </div>
  );
}

// ─── Brand header ───────────────────────────────────────────────────

function BrandHeader() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gradient-to-br from-[#F1641E] to-orange-600 flex items-center justify-center shadow-md shadow-orange-500/20">
          <Sparkles className="size-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight leading-tight">
            SEO Autopilot
          </h1>
          <p className="text-[12px] text-muted-foreground leading-tight mt-0.5">
            Paste · Click · Copy into Etsy
          </p>
        </div>
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 ring-1 ring-emerald-300/40 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 tracking-[0.15em] uppercase">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
        Beta · CEO only
      </div>
    </div>
  );
}

// ─── Input building blocks ──────────────────────────────────────────

function StepRow({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <StepLabel n={n}>{title}</StepLabel>
      <div className="pl-9 space-y-2">{children}</div>
    </div>
  );
}

function StepLabel({
  n,
  children,
}: {
  n: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="size-6 rounded-full bg-foreground text-background flex items-center justify-center text-[11px] font-bold tabular-nums shrink-0">
        {n}
      </div>
      <p className="text-sm font-semibold tracking-tight">{children}</p>
    </div>
  );
}

function Hint({ left, right }: { left: string; right?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px] text-muted-foreground/80 leading-snug">
      <span>{left}</span>
      {right && <span className="tabular-nums shrink-0">{right}</span>}
    </div>
  );
}

interface AdvancedProps {
  sizes: string[];
  setSizes: (v: string[]) => void;
  colors: string[];
  setColors: (v: string[]) => void;
  hasPersonalization: boolean;
  setHasPersonalization: (v: boolean) => void;
  personalizationOptions: string;
  setPersonalizationOptions: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  quantity: string;
  setQuantity: (v: string) => void;
  sku: string;
  setSku: (v: string) => void;
  whoMadeIt: "i_did" | "someone_else" | "collective" | "";
  setWhoMadeIt: (v: "i_did" | "someone_else" | "collective" | "") => void;
  whatIsIt: "finished_product" | "supply" | "";
  setWhatIsIt: (v: "finished_product" | "supply" | "") => void;
  whenMade: string;
  setWhenMade: (v: string) => void;
  processingDays: string;
  setProcessingDays: (v: string) => void;
  returnsPolicy: string;
  setReturnsPolicy: (v: string) => void;
  disabled: boolean;
}

function AdvancedFields(props: AdvancedProps) {
  return (
    <div className="mt-4 pt-4 pl-9 border-t space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <ChipInput
          label="Available sizes"
          values={props.sizes}
          onChange={props.setSizes}
          placeholder="XS, S, M, L, XL"
          suggestions={["XS", "S", "M", "L", "XL", "XXL", "One Size"]}
          disabled={props.disabled}
        />
        <ChipInput
          label="Available colors"
          values={props.colors}
          onChange={props.setColors}
          placeholder="black, white, ivory"
          disabled={props.disabled}
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>Personalization</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            active={!props.hasPersonalization}
            onClick={() => props.setHasPersonalization(false)}
            label="No"
            sub="Standard listing"
            disabled={props.disabled}
          />
          <Toggle
            active={props.hasPersonalization}
            onClick={() => props.setHasPersonalization(true)}
            label="Yes"
            sub="Buyer customizes"
            disabled={props.disabled}
          />
        </div>
        {props.hasPersonalization && (
          <Textarea
            value={props.personalizationOptions}
            onChange={(e) => props.setPersonalizationOptions(e.target.value)}
            placeholder="What can buyers customize? (e.g. 'name to engrave, max 12 chars')"
            className="min-h-[56px] resize-none text-sm"
            disabled={props.disabled}
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <FieldLabel>Price (USD)</FieldLabel>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={props.price}
            onChange={(e) => props.setPrice(e.target.value)}
            placeholder="24.99"
            className="text-sm"
            disabled={props.disabled}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Quantity</FieldLabel>
          <Input
            type="number"
            min="0"
            inputMode="numeric"
            value={props.quantity}
            onChange={(e) => props.setQuantity(e.target.value)}
            placeholder="100"
            className="text-sm"
            disabled={props.disabled}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>SKU</FieldLabel>
          <Input
            value={props.sku}
            onChange={(e) => props.setSku(e.target.value)}
            placeholder="DRESS-001"
            className="text-sm"
            disabled={props.disabled}
          />
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel>Who made it / What is it</FieldLabel>
        <div className="grid grid-cols-3 gap-2">
          <Toggle
            active={props.whoMadeIt === "i_did"}
            onClick={() => props.setWhoMadeIt("i_did")}
            label="I did"
            disabled={props.disabled}
          />
          <Toggle
            active={props.whoMadeIt === "collective"}
            onClick={() => props.setWhoMadeIt("collective")}
            label="Shop member"
            disabled={props.disabled}
          />
          <Toggle
            active={props.whoMadeIt === "someone_else"}
            onClick={() => props.setWhoMadeIt("someone_else")}
            label="Someone else"
            disabled={props.disabled}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            active={props.whatIsIt === "finished_product"}
            onClick={() => props.setWhatIsIt("finished_product")}
            label="Finished product"
            disabled={props.disabled}
          />
          <Toggle
            active={props.whatIsIt === "supply"}
            onClick={() => props.setWhatIsIt("supply")}
            label="Supply / tool"
            disabled={props.disabled}
          />
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel>When was it made</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            active={props.whenMade === "made_to_order"}
            onClick={() => props.setWhenMade("made_to_order")}
            label="Made to order"
            disabled={props.disabled}
          />
          <Toggle
            active={props.whenMade === "2020_2026"}
            onClick={() => props.setWhenMade("2020_2026")}
            label="2020-2026"
            disabled={props.disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <FieldLabel>Processing time</FieldLabel>
          <Input
            value={props.processingDays}
            onChange={(e) => props.setProcessingDays(e.target.value)}
            placeholder="1-3 business days"
            className="text-sm"
            disabled={props.disabled}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Returns policy</FieldLabel>
          <Input
            value={props.returnsPolicy}
            onChange={(e) => props.setReturnsPolicy(e.target.value)}
            placeholder="30-day returns"
            className="text-sm"
            disabled={props.disabled}
          />
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-foreground/70 uppercase tracking-[0.14em]">
      {children}
    </p>
  );
}

function Toggle({
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
      className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-foreground bg-foreground/5"
          : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <p className="text-xs font-semibold leading-tight">{label}</p>
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
  values,
  onChange,
  placeholder,
  suggestions,
  disabled,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function commit(raw: string) {
    const tokens = raw.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
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
      <FieldLabel>{label}</FieldLabel>
      <div className="rounded-lg border bg-card px-2 py-2 min-h-[40px] flex flex-wrap gap-1.5 items-center">
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

// ─── Progress / Error / Blocked ─────────────────────────────────────

function ProgressCard({
  stage,
}: {
  stage: "idle" | "reading" | "checking" | "researching" | "writing" | "auditing";
}) {
  const order = ["reading", "checking", "researching", "writing", "auditing"] as const;
  const idx = order.indexOf(stage as (typeof order)[number]);
  const labels = {
    reading: "Reading your title",
    checking: "Strict compliance check",
    researching: "Researching live Etsy data",
    writing: "Writing your listing",
    auditing: "Final rule check",
  } as const;
  return (
    <Card className="border shadow-none">
      <CardContent className="p-6 sm:p-7 space-y-5">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 text-orange-500 animate-spin" />
          <div>
            <p className="text-sm font-semibold">Autopilot is working</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Usually 25-40 seconds with images.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {order.map((s, i) => {
            const done = i < idx;
            const active = i === idx;
            return (
              <div
                key={s}
                className="flex items-center gap-3 text-xs"
              >
                {done ? (
                  <Check className="size-4 text-emerald-500 shrink-0" strokeWidth={3} />
                ) : active ? (
                  <Loader2 className="size-4 text-orange-500 animate-spin shrink-0" />
                ) : (
                  <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                )}
                <span
                  className={
                    done || active ? "text-foreground" : "text-muted-foreground/60"
                  }
                >
                  {labels[s]}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-rose-300/50 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 shadow-none">
      <CardContent className="p-5 flex items-start gap-3">
        <AlertTriangle className="size-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
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

function BlockedCard({ verdict }: { verdict: ComplianceVerdict }) {
  return (
    <Card className="border-rose-400 dark:border-rose-700 bg-rose-50/60 dark:bg-rose-950/30 shadow-none">
      <CardContent className="p-6 sm:p-7 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0">
            <Ban className="size-5 text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.18em]">
              Blocked
            </p>
            <h3 className="text-lg font-bold text-rose-900 dark:text-rose-200 leading-tight">
              Do not list this on Etsy
            </h3>
          </div>
        </div>

        <p className="text-sm text-foreground leading-relaxed">
          {verdict.summary}
        </p>

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-[0.16em]">
            Why
          </p>
          <ul className="space-y-1.5">
            {verdict.concerns.map((c, i) => (
              <li
                key={i}
                className="text-[12px] text-foreground/85 flex gap-2 items-start"
              >
                <span className="mt-1 size-1.5 rounded-full bg-rose-500 shrink-0" />
                <span>
                  <span className="font-semibold uppercase text-[10px] tracking-wider opacity-70 mr-1.5">
                    {c.category}
                  </span>
                  {c.details}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-rose-700/90 dark:text-rose-300/80 leading-snug border-t border-rose-300/40 dark:border-rose-700/40 pt-3">
          Etsy can remove listings within hours of detecting IP/policy issues
          and may strike the shop. Source a different version of this product
          or pick something else to list.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Result card ─────────────────────────────────────────────────────

function ResultCard({
  data,
  userImages,
}: {
  data: GenerateResponse;
  userImages: UploadedImage[];
}) {
  const { listing, compliance, research, textCompliance, inputs } = data;

  // Mutable copies of tags + intel so the swap-tag UI can rewrite them
  // in place. The parent passes `key={data.generatedAt}` so a fresh
  // generation remounts this component and re-initializes state.
  const [tags, setTags] = useState<string[]>(listing?.tags ?? []);
  const [tagIntel, setTagIntel] = useState<TagDemand[]>(
    data.tagIntelligence ?? [],
  );

  if (!listing) return null;

  const hasVariations =
    (inputs?.sizes.length ?? 0) > 0 || (inputs?.colors.length ?? 0) > 0;
  const hasPricing =
    inputs?.price != null || inputs?.quantity != null || !!inputs?.sku;
  const hasDelivery = !!inputs?.processingDays || !!inputs?.returnsPolicy;

  function handleSwapTag(oldTag: string, newSuggestion: SwapSuggestion) {
    setTags((prev) => prev.map((t) => (t === oldTag ? newSuggestion.tag : t)));
    setTagIntel((prev) => {
      const without = prev.filter((t) => t.tag !== oldTag);
      // Add a synthesised TagDemand record for the new tag using the
      // demand data the API returned.
      const next: TagDemand = {
        tag: newSuggestion.tag,
        totalListings: newSuggestion.totalListings,
        topFavorites: [],
        avgTopFavorites: newSuggestion.avgTopFavorites,
        demandScore: 0,
        tier: newSuggestion.tier,
      };
      return [...without, next];
    });
    toast.success("Tag swapped", { description: `${oldTag} → ${newSuggestion.tag}` });
  }

  return (
    <Card className="border shadow-none">
      <CardContent className="p-6 sm:p-7">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 pb-5 mb-1 border-b">
          <div className="min-w-0">
            <h3 className="text-lg font-bold tracking-tight">
              Your Etsy listing
            </h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Walk down this list, copying each field into Etsy.
            </p>
          </div>
          <ComplianceChip verdict={compliance} />
        </div>

        {/* Auto-decisions chip row */}
        <DecisionStrip research={research} />

        {/* Compliance warnings (if REVIEW) */}
        {compliance.verdict === "REVIEW" && compliance.concerns.length > 0 && (
          <WarningStrip
            title="Review before listing"
            issues={compliance.concerns.map((c) => ({
              severity: c.severity,
              label: c.category,
              message: c.details,
            }))}
          />
        )}

        {/* Text compliance warnings */}
        {textCompliance &&
          textCompliance.issues.length > 0 &&
          (compliance.verdict === "ALLOWED" || compliance.verdict === "REVIEW") && (
            <WarningStrip
              title="Text rule check"
              issues={textCompliance.issues.map((i) => ({
                severity: i.severity,
                label: i.field,
                message: i.message,
              }))}
            />
          )}

        {/* ── FIELDS ── */}
        <Row
          label="Category"
          value={research.categoryPath}
          copyValue={research.categoryPath}
        />
        <Row label="Item type" value={TYPE_LABEL[listing.suggestedType]} />
        <Row
          label="When made"
          value={whenMadeLabel(listing.suggestedWhenMade)}
        />

        <Divider />

        <TitleRow title={listing.title} />
        <DescriptionRow description={listing.description} />

        {(hasVariations || listing.personalizationInstructions) && <Divider />}

        {hasVariations && inputs && (
          <VariationsRow sizes={inputs.sizes} colors={inputs.colors} />
        )}
        {listing.personalizationInstructions && (
          <Row
            label="Personalization instructions"
            value={`"${listing.personalizationInstructions}"`}
            copyValue={listing.personalizationInstructions}
            valueClass="italic"
          />
        )}

        <Divider />

        <TagsRow
          tags={tags}
          intelligence={tagIntel}
          productTitle={research.searchKeyword}
          productType={research.productType}
          category={research.categoryPath}
          onSwap={handleSwapTag}
        />

        {listing.materials.length > 0 && (
          <Row
            label="Materials"
            value={listing.materials.join(", ")}
            copyValue={listing.materials.join(", ")}
          />
        )}

        {listing.attributes.length > 0 && (
          <AttributesRow attributes={listing.attributes} />
        )}

        {(hasPricing || hasDelivery) && <Divider />}

        {hasPricing && inputs && (
          <div className="grid grid-cols-3 gap-3 py-4">
            {inputs.price != null && (
              <MiniRow label="Price" value={`$${inputs.price.toFixed(2)}`} />
            )}
            {inputs.quantity != null && (
              <MiniRow label="Quantity" value={String(inputs.quantity)} />
            )}
            {inputs.sku && <MiniRow label="SKU" value={inputs.sku} />}
          </div>
        )}

        {hasDelivery && inputs && (
          <div className="grid grid-cols-2 gap-3 py-4">
            {inputs.processingDays && (
              <MiniRow label="Processing" value={inputs.processingDays} />
            )}
            {inputs.returnsPolicy && (
              <MiniRow label="Returns" value={inputs.returnsPolicy} />
            )}
          </div>
        )}

        <Divider />

        <AltTextRow altTexts={listing.altTexts} images={userImages} />

        <Divider />

        <div className="grid sm:grid-cols-2 gap-x-6">
          <MiniRow
            label="Who made it"
            value={WHO_MADE_LABEL[listing.suggestedWhoMadeIt]}
          />
          <MiniRow
            label="What is it"
            value={WHAT_IS_IT_LABEL[listing.suggestedWhatIsIt]}
          />
        </div>
        <MiniRow label="Renewal" value="Automatic" />
      </CardContent>
    </Card>
  );
}

// ─── Result building blocks ─────────────────────────────────────────

function ComplianceChip({ verdict }: { verdict: ComplianceVerdict }) {
  if (verdict.verdict === "ALLOWED") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 ring-1 ring-emerald-300/40 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 tracking-wider uppercase shrink-0">
        <ShieldCheck className="size-3" />
        Cleared
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950/40 ring-1 ring-amber-300/40 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 tracking-wider uppercase shrink-0">
      <AlertTriangle className="size-3" />
      Review
    </div>
  );
}

function DecisionStrip({ research }: { research: ResearchSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-4 mb-2 text-[11px]">
      <DecisionChip label="Searched" value={research.searchKeyword} />
      <DecisionChip label="Category" value={research.categoryPath} />
      <DecisionChip
        label="Read"
        value={`${research.competitorsAnalyzed} listings`}
      />
      {research.audienceHint && (
        <DecisionChip label="Audience" value={research.audienceHint} />
      )}
    </div>
  );
}

function DecisionChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1 max-w-full">
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </span>
      <span className="text-[11px] font-medium text-foreground truncate">
        {value}
      </span>
    </span>
  );
}

function WarningStrip({
  title,
  issues,
}: {
  title: string;
  issues: Array<{ severity: "warn" | "block"; label: string; message: string }>;
}) {
  return (
    <div className="mt-3 mb-1 rounded-lg border border-amber-300/50 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/15 px-3 py-2.5">
      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-1.5">
        {title}
      </p>
      <ul className="space-y-1">
        {issues.map((i, idx) => (
          <li key={idx} className="text-[11px] flex gap-2 items-start">
            <span
              className={`mt-1 size-1.5 rounded-full shrink-0 ${
                i.severity === "block" ? "bg-rose-500" : "bg-amber-500"
              }`}
            />
            <span>
              <span className="font-semibold uppercase text-[9px] tracking-wider opacity-70 mr-1">
                {i.label}
              </span>
              {i.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t border-border/60" />;
}

function Row({
  label,
  value,
  copyValue,
  valueClass,
}: {
  label: string;
  value: string;
  copyValue?: string;
  valueClass?: string;
}) {
  return (
    <div className="py-3.5 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-1">
          {label}
        </p>
        <p
          className={`text-sm font-medium text-foreground leading-relaxed break-words ${valueClass ?? ""}`}
        >
          {value}
        </p>
      </div>
      {copyValue && (
        <CopyButton value={copyValue} label={label.toLowerCase()} />
      )}
    </div>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2 flex items-center justify-between gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <span className="text-[12px] font-medium text-foreground text-right">
        {value}
      </span>
    </div>
  );
}

function TitleRow({ title }: { title: string }) {
  const pct = (title.length / TITLE_MAX) * 100;
  const tone =
    pct > 100
      ? "rose"
      : pct >= 80
        ? "emerald"
        : pct >= 50
          ? "amber"
          : "muted";
  return (
    <div className="py-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Title
        </p>
        <CopyButton value={title} label="title" />
      </div>
      <p className="text-base font-semibold leading-snug break-words">
        {title}
      </p>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
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
        <p className="text-[10px] font-semibold tabular-nums text-muted-foreground">
          {title.length}/{TITLE_MAX}
        </p>
      </div>
    </div>
  );
}

function DescriptionRow({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > 320;
  return (
    <div className="py-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Description{" "}
          <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
            · {description.length} chars
          </span>
        </p>
        <CopyButton value={description} label="description" />
      </div>
      <div
        className={`rounded-md bg-muted/30 px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90 ${
          expanded || !isLong ? "" : "max-h-[140px] overflow-hidden relative"
        }`}
      >
        {description}
        {!expanded && isLong && (
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted/80 to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronDown
            className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Collapse" : "Read full description"}
        </button>
      )}
    </div>
  );
}

function VariationsRow({
  sizes,
  colors,
}: {
  sizes: string[];
  colors: string[];
}) {
  return (
    <div className="py-3.5 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Variations
      </p>
      {sizes.length > 0 && (
        <ChipDisplay label="Sizes" values={sizes} copyAll />
      )}
      {colors.length > 0 && (
        <ChipDisplay label="Colors" values={colors} copyAll />
      )}
    </div>
  );
}

function ChipDisplay({
  label,
  values,
  copyAll,
}: {
  label: string;
  values: string[];
  copyAll?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider mr-1">
        {label}
      </span>
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium"
        >
          {v}
        </span>
      ))}
      {copyAll && (
        <CopyButton value={values.join(", ")} label={label.toLowerCase()} size="xs" />
      )}
    </div>
  );
}

interface SwapSuggestion {
  tag: string;
  reason: string;
  totalListings: number;
  avgTopFavorites: number;
  tier: TagTier;
}

function TagsRow({
  tags,
  intelligence,
  productTitle,
  productType,
  category,
  onSwap,
}: {
  tags: string[];
  intelligence: TagDemand[];
  productTitle: string;
  productType: string;
  category: string;
  onSwap: (oldTag: string, newSuggestion: SwapSuggestion) => void;
}) {
  const intelByTag = new Map(intelligence.map((i) => [i.tag, i]));

  async function copyAll() {
    await navigator.clipboard.writeText(tags.join(", "));
    toast.success(`Copied all ${tags.length} tags`);
  }

  return (
    <div className="py-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Tags{" "}
          <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
            · {tags.length}/13 · tap to copy · ↻ to swap
          </span>
        </p>
        <button
          type="button"
          onClick={copyAll}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 text-foreground/80 transition-colors"
        >
          <Copy className="size-3" /> Copy all
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, idx) => {
          const intel = intelByTag.get(tag);
          return (
            <TagPillWithSwap
              key={`${tag}-${idx}-${tag.length}`}
              tag={tag}
              intel={intel}
              productTitle={productTitle}
              productType={productType}
              category={category}
              existingTags={tags}
              onSwap={(suggestion) => onSwap(tag, suggestion)}
            />
          );
        })}
      </div>
    </div>
  );
}

function TagPillWithSwap({
  tag,
  intel,
  productTitle,
  productType,
  category,
  existingTags,
  onSwap,
}: {
  tag: string;
  intel?: TagDemand;
  productTitle: string;
  productType: string;
  category: string;
  existingTags: string[];
  onSwap: (suggestion: SwapSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SwapSuggestion[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const isLong = tag.length > TAG_MAX;

  async function handleCopy() {
    await navigator.clipboard.writeText(tag);
    setCopied(true);
    toast.success(`Copied "${tag}"`);
    setTimeout(() => setCopied(false), 1500);
  }

  async function fetchSuggestions() {
    setLoading(true);
    setFetchError(null);
    setSuggestions(null);
    try {
      const res = await fetch("/api/seo-autopilot/swap-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentTag: tag,
          productTitle,
          productType,
          category,
          existingTags,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function handlePickSuggestion(s: SwapSuggestion) {
    onSwap(s);
    setOpen(false);
    setSuggestions(null);
    setFetchError(null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSuggestions(null);
          setFetchError(null);
        }
      }}
    >
      <div
        className={`inline-flex items-center gap-1 rounded-full ring-1 transition-colors ${
          isLong
            ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 ring-rose-300/50"
            : copied
              ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 ring-emerald-300/50"
              : "bg-card hover:bg-muted/50 text-foreground/85 ring-border"
        }`}
      >
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 pl-2.5 py-1 text-[11px] font-medium"
          title={
            intel
              ? `${tag} · ${formatCount(intel.totalListings)} listings · avg ${intel.avgTopFavorites} favs · tap to copy`
              : `Copy "${tag}"`
          }
        >
          {copied ? (
            <Check className="size-3 text-emerald-600" />
          ) : (
            <Hash className="size-3 opacity-40" />
          )}
          <span>{tag}</span>
          {intel && (
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${TIER_STYLE[intel.tier]}`}
            >
              <span>{TIER_GLYPH[intel.tier]}</span>
              <span>{formatCount(intel.totalListings)}</span>
            </span>
          )}
        </button>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="size-6 rounded-full hover:bg-muted/60 text-muted-foreground hover:text-foreground flex items-center justify-center mr-0.5"
              title="Suggest replacement tags"
            />
          }
        >
          <Shuffle className="size-3" />
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="start"
        className="w-80 p-3 space-y-3"
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Replace this tag
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">&ldquo;{tag}&rdquo;</span>
            {intel && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${TIER_STYLE[intel.tier]}`}
              >
                <span>{TIER_GLYPH[intel.tier]}</span>
                <span>{formatCount(intel.totalListings)}</span>
              </span>
            )}
          </div>
        </div>

        {!suggestions && !loading && !fetchError && (
          <Button
            type="button"
            onClick={fetchSuggestions}
            size="sm"
            className="w-full h-8 gap-1.5 text-xs"
          >
            <Shuffle className="size-3" />
            Suggest 3 alternatives
          </Button>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="size-3.5 animate-spin" />
            Finding better alternatives…
          </div>
        )}

        {fetchError && (
          <div className="text-xs text-rose-600 dark:text-rose-400 py-2">
            {fetchError}
            <button
              type="button"
              onClick={fetchSuggestions}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}

        {suggestions && suggestions.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">
            No good alternatives found — your current tag may already be the best fit.
          </p>
        )}

        {suggestions && suggestions.length > 0 && (
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.tag}>
                <button
                  type="button"
                  onClick={() => handlePickSuggestion(s)}
                  className="w-full text-left rounded-md border bg-card hover:bg-muted/40 px-2.5 py-2 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-sm font-semibold">{s.tag}</span>
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${TIER_STYLE[s.tier]}`}
                    >
                      <span>{TIER_GLYPH[s.tier]}</span>
                      <span>{formatCount(s.totalListings)}</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {s.reason}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {suggestions && (
          <button
            type="button"
            onClick={fetchSuggestions}
            disabled={loading}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? "Regenerating…" : "Try 3 new ones"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AttributesRow({
  attributes,
}: {
  attributes: { name: string; value: string }[];
}) {
  return (
    <div className="py-3.5 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Category attributes{" "}
        <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
          · {attributes.length} pre-filled
        </span>
      </p>
      <div className="grid sm:grid-cols-2 gap-x-6">
        {attributes.map((a, i) => (
          <div
            key={`${a.name}-${i}`}
            className="py-1.5 flex items-center justify-between gap-2 border-b border-border/40 last:border-0"
          >
            <div className="min-w-0">
              <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
                {a.name}
              </p>
              <p className="text-[12px] font-medium text-foreground truncate">
                {a.value}
              </p>
            </div>
            <CopyButton value={a.value} label={a.name} size="xs" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AltTextRow({
  altTexts,
  images,
}: {
  altTexts: string[];
  images: UploadedImage[];
}) {
  if (altTexts.length === 0) return null;
  return (
    <div className="py-3.5 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Image alt text
      </p>
      <div className="space-y-2">
        {altTexts.map((alt, idx) => {
          const img = images[idx];
          return (
            <div
              key={idx}
              className="rounded-md bg-muted/30 px-3 py-2 flex gap-3 items-start"
            >
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.previewUrl}
                  alt=""
                  className="size-12 rounded-md object-cover shrink-0 ring-1 ring-border"
                />
              ) : (
                <div className="size-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <ImageIcon className="size-4 text-muted-foreground/40" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
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
    </div>
  );
}

// ─── Insights card (collapsible) ────────────────────────────────────

function InsightsCard({ data }: { data: GenerateResponse }) {
  const [open, setOpen] = useState(false);
  const tagIntel = data.tagIntelligence ?? [];
  const anchors = data.anchorKeywords;
  const buyerKeywords = data.buyerKeywords ?? [];
  const hasAnchors =
    !!anchors &&
    (anchors.topPhrases.length > 0 || anchors.topTags.length > 0);
  const hasBuyerKeywords = buyerKeywords.length > 0;
  const hasInsights =
    tagIntel.length > 0 ||
    data.research.topCompetitors.length > 0 ||
    data.listing?.rationale.keywordFocus ||
    hasAnchors ||
    hasBuyerKeywords;

  if (!hasInsights) return null;

  return (
    <Card className="border shadow-none">
      <CardContent className="p-5 sm:p-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <TrendingUp className="size-4 text-muted-foreground" />
            <p className="text-sm font-semibold">More insights</p>
            <p className="text-[11px] text-muted-foreground">
              Buyer searches · anchors · tag demand · competitors
            </p>
          </div>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="mt-5 space-y-6">
            {hasBuyerKeywords && (
              <BuyerKeywordsSection buyerKeywords={buyerKeywords} />
            )}
            {hasAnchors && anchors && <AnchorKeywordsSection anchors={anchors} />}
            {tagIntel.length > 0 && <TagIntelligenceTable intel={tagIntel} />}
            {data.listing?.rationale.keywordFocus && (
              <RationaleSection rationale={data.listing.rationale} />
            )}
            {data.research.topCompetitors.length > 0 && (
              <CompetitorsSection
                competitors={data.research.topCompetitors}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BuyerKeywordsSection({
  buyerKeywords,
}: {
  buyerKeywords: BuyerKeywordScore[];
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Buyer-search keywords
        </p>
        <p className="text-[11px] text-muted-foreground/80 leading-snug">
          Long-tail variants Autopilot brainstormed, scored against live
          Etsy demand. These are what real buyers TYPE into the search
          bar — higher signal than what competitors wrote.
        </p>
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold text-left">Phrase</th>
              <th className="px-3 py-2 font-semibold text-right">Listings</th>
              <th className="px-3 py-2 font-semibold text-right">Top favs</th>
              <th className="px-3 py-2 font-semibold text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {buyerKeywords.map((kw) => (
              <tr key={kw.keyword} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-5 rounded-full flex items-center justify-center text-[10px] ring-1 ${TIER_STYLE[kw.tier]}`}
                    >
                      {TIER_GLYPH[kw.tier]}
                    </span>
                    <span className="font-medium">{kw.keyword}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(kw.totalListings)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {kw.avgTopFavorites.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <DemandBar score={kw.buyerScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnchorKeywordsSection({ anchors }: { anchors: AnchorKeywords }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Anchor keywords
        </p>
        <p className="text-[11px] text-muted-foreground/80 leading-snug">
          High-frequency phrases + tags pulled from the top{" "}
          {anchors.totalListings} ranking listings. Autopilot front-loads these
          in the title and tag set to mirror what&apos;s already winning.
        </p>
      </div>

      {anchors.topPhrases.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Phrases (title signal)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {anchors.topPhrases.map((p) => (
              <span
                key={p.phrase}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 ring-1 ring-border px-2.5 py-0.5 text-[11px]"
                title={`${p.count} of ${anchors.totalListings} listings`}
              >
                <span className="font-medium">{p.phrase}</span>
                <span className="text-[9px] font-bold text-muted-foreground tabular-nums">
                  {p.percentage}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {anchors.topTags.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Tags (seller-curated signal)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {anchors.topTags.map((t) => (
              <span
                key={t.phrase}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-300/40 px-2.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300"
                title={`${t.count} of ${anchors.totalListings} listings`}
              >
                <span className="font-medium">{t.phrase}</span>
                <span className="text-[9px] font-bold tabular-nums">
                  {t.percentage}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TagIntelligenceTable({ intel }: { intel: TagDemand[] }) {
  const [sortBy, setSortBy] = useState<"score" | "listings" | "tag">("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  function toggle(col: typeof sortBy) {
    if (sortBy === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setDir(col === "tag" ? "asc" : "desc");
    }
  }

  const sorted = [...intel].sort((a, b) => {
    const m = dir === "asc" ? 1 : -1;
    if (sortBy === "tag") return a.tag.localeCompare(b.tag) * m;
    if (sortBy === "listings") return (a.totalListings - b.totalListings) * m;
    return (a.demandScore - b.demandScore) * m;
  });

  const counts = intel.reduce(
    (acc, t) => {
      acc[t.tier] = (acc[t.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<TagTier, number>,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Tag intelligence — live Etsy demand
        </p>
        <div className="flex items-center gap-1">
          {(["niche", "moderate", "hot", "saturated"] as TagTier[]).map((t) =>
            counts[t] ? (
              <span
                key={t}
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${TIER_STYLE[t]}`}
                title={TIER_DESCRIPTION[t]}
              >
                <span>{TIER_GLYPH[t]}</span>
                <span>{counts[t]}</span>
              </span>
            ) : null,
          )}
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th
                label="Tag"
                active={sortBy === "tag"}
                dir={dir}
                onClick={() => toggle("tag")}
              />
              <Th
                label="Listings"
                active={sortBy === "listings"}
                dir={dir}
                onClick={() => toggle("listings")}
                align="right"
              />
              <Th
                label="Top favs"
                active={false}
                dir={dir}
                onClick={() => {}}
                align="right"
                disabled
              />
              <Th
                label="Demand"
                active={sortBy === "score"}
                dir={dir}
                onClick={() => toggle("score")}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.tag} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-5 rounded-full flex items-center justify-center text-[10px] ring-1 ${TIER_STYLE[r.tier]}`}
                    >
                      {TIER_GLYPH[r.tier]}
                    </span>
                    <span>{r.tag}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.error ? "—" : formatCount(r.totalListings)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {r.error ? "—" : r.avgTopFavorites.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <DemandBar score={r.demandScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        Etsy doesn&apos;t share real search volume. These are live counts from{" "}
        <code>/listings/active</code> for each tag — a strong proxy for demand
        and competition.
      </p>
    </div>
  );
}

function Th({
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
  align?: "left" | "right";
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
        } disabled:hover:text-muted-foreground disabled:cursor-default`}
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
    <div className="inline-flex items-center gap-2">
      <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${
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
      <span className="text-[11px] tabular-nums font-semibold w-7 text-right">
        {score}
      </span>
    </div>
  );
}

function RationaleSection({
  rationale,
}: {
  rationale: GeneratedListing["rationale"];
}) {
  const rows = [
    { label: "Keyword focus", value: rationale.keywordFocus },
    { label: "Title strategy", value: rationale.titleStrategy },
    { label: "Audience hook", value: rationale.audienceHook },
  ].filter((r) => r.value);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Why this works
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-md bg-muted/30 px-3 py-2"
          >
            <p className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-0.5">
              {r.label}
            </p>
            <p className="text-[12px] text-foreground/85 leading-relaxed">
              {r.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitorsSection({
  competitors,
}: {
  competitors: { rank: number; title: string; favorites: number }[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Top 5 competitors Autopilot read
      </p>
      <ul className="space-y-1.5">
        {competitors.map((c) => (
          <li
            key={c.rank}
            className="rounded-md bg-muted/30 px-3 py-2 flex items-start gap-3"
          >
            <div className="size-6 rounded-md bg-foreground/10 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-foreground/70 tabular-nums">
                #{c.rank}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-foreground/90 leading-snug line-clamp-2">
                {c.title}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                <Heart className="size-2.5" />
                <span className="tabular-nums">
                  {c.favorites.toLocaleString()}
                </span>{" "}
                favorites
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Copy button (shared) ───────────────────────────────────────────

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
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md hover:bg-muted/60 text-muted-foreground transition-colors shrink-0"
      >
        {copied ? (
          <Check className="size-3 text-emerald-500" />
        ) : (
          <Copy className="size-3" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    );
  }
  return (
    <button
      onClick={handleCopy}
      type="button"
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-muted/60 text-foreground/80 transition-colors shrink-0"
    >
      {copied ? (
        <>
          <Check className="size-3 text-emerald-500" /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3" /> Copy
        </>
      )}
    </button>
  );
}

