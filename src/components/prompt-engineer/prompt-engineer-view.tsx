"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wand2,
  ImagePlus,
  Copy,
  Check,
  RotateCcw,
  Lock,
  Sparkles,
  X,
} from "lucide-react";

type ModelType = "woman" | "man" | "girl" | "boy" | "kid";

interface PromptResult {
  id: number;
  thumb: string; // data URL for preview
  productSummary: string;
  prompt: string;
  negativePrompt: string;
}

const MODEL_TYPES: { value: ModelType; label: string }[] = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "girl", label: "Girl" },
  { value: "boy", label: "Boy" },
  { value: "kid", label: "Kid" },
];

const BACKGROUNDS = [
  "Studio white",
  "Lifestyle indoor",
  "Outdoor natural",
  "Plain colored backdrop",
  "Custom",
];
const STYLES = [
  "Clean e-commerce",
  "Editorial fashion",
  "Casual lifestyle",
  "Studio glam",
];
const ORIENTATIONS = ["Portrait", "Square", "Landscape"];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      onClick={() => {
        if (!text) return;
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {ok ? "Copied" : label}
    </Button>
  );
}

export function PromptEngineerView() {
  const fileRef = useRef<HTMLInputElement>(null);

  // Listing session
  const [modelType, setModelType] = useState<ModelType>("woman");
  const [modelPersona, setModelPersona] = useState<string | null>(null);

  // Per-image options
  const [background, setBackground] = useState("Studio white");
  const [customBackground, setCustomBackground] = useState("");
  const [style, setStyle] = useState("Clean e-commerce");
  const [orientation, setOrientation] = useState("Portrait");
  const [autoPose, setAutoPose] = useState(true);
  const [pose, setPose] = useState("");
  const [freeText, setFreeText] = useState("");

  // Current image
  const [imgBase64, setImgBase64] = useState<string | null>(null);
  const [imgMediaType, setImgMediaType] = useState<string | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PromptResult[]>([]);
  const [costUsd, setCostUsd] = useState(0);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      toast.error("Please upload a JPEG, PNG, WEBP or GIF image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image too large (max 10 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImgPreview(dataUrl);
      setImgBase64(dataUrl.split(",")[1] ?? null);
      setImgMediaType(file.type);
    };
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setImgBase64(null);
    setImgMediaType(null);
    setImgPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function newListing() {
    setModelPersona(null);
    setResults([]);
    setCostUsd(0);
    clearImage();
    toast.success("Started a new listing — model will be re-locked on the next image.");
  }

  async function generate() {
    if (!imgBase64 || !imgMediaType) {
      toast.error("Upload a product photo first.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/prompt-engineer/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: { base64: imgBase64, mediaType: imgMediaType },
          modelType,
          background: background === "Custom" ? customBackground : background,
          style,
          pose: autoPose ? null : pose,
          orientation,
          freeText: freeText || null,
          modelPersona, // null on first image → backend invents + returns it
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      // Lock the persona from the first generation.
      if (!modelPersona && data.modelPersona) setModelPersona(data.modelPersona);
      setCostUsd((c) => c + (data.costUsd || 0));
      setResults((prev) => [
        {
          id: Date.now(),
          thumb: imgPreview || "",
          productSummary: data.productSummary || "",
          prompt: data.prompt || "",
          negativePrompt: data.negativePrompt || "",
        },
        ...prev,
      ]);
      clearImage();
      setFreeText("");
      toast.success("Prompt ready — copy it into Higgsfield.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/30">
            <Wand2 className="size-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Prompt Engineer</h1>
            <p className="text-xs text-muted-foreground">
              Product photo → Higgsfield prompt · same product, USA model, new pose
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {costUsd > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              ${costUsd.toFixed(4)} this listing
            </span>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={newListing}>
            <RotateCcw className="size-3.5" /> New listing
          </Button>
        </div>
      </div>

      {/* Model lock status */}
      <Card>
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {modelPersona ? (
                <>
                  <Lock className="size-4 text-emerald-600 dark:text-emerald-400" />
                  Model locked for this listing
                </>
              ) : (
                <>
                  <Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
                  Step 1 — pick the model type
                </>
              )}
            </CardTitle>
            {!modelPersona && (
              <div className="w-[160px]">
                <Select value={modelType} onValueChange={(v) => v && setModelType(v as ModelType)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_TYPES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        {modelPersona && (
          <CardContent className="pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Locked persona (reused on every image — same model throughout)
            </p>
            <Textarea
              value={modelPersona}
              onChange={(e) => setModelPersona(e.target.value)}
              rows={3}
              className="text-xs"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Edit if you want — the next images will use whatever is here. Hit “New listing” to start a fresh model.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Upload + options */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Upload */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-semibold">Step 2 — product photo</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={onPickFile}
            />
            {imgPreview ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgPreview}
                  alt="product"
                  className="w-full rounded-lg border object-contain max-h-72 bg-muted/30"
                />
                <button
                  onClick={clearImage}
                  className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  aria-label="Remove image"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-12 text-muted-foreground hover:border-violet-400 hover:text-violet-600 transition-colors"
              >
                <ImagePlus className="size-7" />
                <span className="text-sm font-medium">Upload AliExpress photo</span>
                <span className="text-[11px]">JPEG / PNG / WEBP · max 10 MB</span>
              </button>
            )}
          </CardContent>
        </Card>

        {/* Options */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-semibold">Step 3 — options</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Background</Label>
                <Select value={background} onValueChange={(v) => v && setBackground(v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BACKGROUNDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Style / mood</Label>
                <Select value={style} onValueChange={(v) => v && setStyle(v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {background === "Custom" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Custom background</Label>
                <Input
                  value={customBackground}
                  onChange={(e) => setCustomBackground(e.target.value)}
                  placeholder="e.g. marble bathroom counter, cafe window seat…"
                  className="h-9 text-xs"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Orientation</Label>
                <Select value={orientation} onValueChange={(v) => v && setOrientation(v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORIENTATIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pose</Label>
                <Select
                  value={autoPose ? "auto" : "custom"}
                  onValueChange={(v) => setAutoPose(v === "auto")}
                >
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (different from source)</SelectItem>
                    <SelectItem value="custom">Specify a pose</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!autoPose && (
              <div className="space-y-1.5">
                <Label className="text-xs">Pose description</Label>
                <Input
                  value={pose}
                  onChange={(e) => setPose(e.target.value)}
                  placeholder="e.g. walking, hand on hip, looking over shoulder…"
                  className="h-9 text-xs"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Extra instructions (optional)</Label>
              <Textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Anything else — e.g. golden-hour light, show the back, close-up on fabric…"
                rows={2}
                className="text-xs"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Button
        onClick={generate}
        disabled={loading || !imgBase64}
        className="w-full gap-2"
        size="lg"
      >
        <Wand2 className="size-4" />
        {loading
          ? "Generating…"
          : modelPersona
            ? "Generate prompt (same model)"
            : "Generate prompt & lock model"}
      </Button>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Prompts for this listing ({results.length})
            </h2>
          </div>
          {results.map((r) => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex gap-4">
                  {r.thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumb}
                      alt="source"
                      className="size-16 shrink-0 rounded-md border object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    {r.productSummary && (
                      <p className="text-[11px] text-muted-foreground italic">
                        {r.productSummary}
                      </p>
                    )}
                    <div className="rounded-lg bg-muted/40 p-3">
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">{r.prompt}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <CopyButton text={r.prompt} label="Copy prompt" />
                      {r.negativePrompt && (
                        <CopyButton text={r.negativePrompt} label="Copy negative" />
                      )}
                    </div>
                    {r.negativePrompt && (
                      <p className="text-[10px] text-muted-foreground">
                        <span className="font-semibold">Negative:</span> {r.negativePrompt}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
