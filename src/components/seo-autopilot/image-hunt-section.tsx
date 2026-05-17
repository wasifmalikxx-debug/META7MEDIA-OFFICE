"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Sparkles,
  Image as ImageIcon,
  Package,
  Star,
  Upload,
  X,
  ClipboardPaste,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Image Hunt section — lives inside the Product Hunter hub.
 *
 * Three ways to supply the source image:
 *   1. URL paste (works great with Etsy listing image URLs)
 *   2. File upload via click or drag-drop
 *   3. Clipboard paste (Cmd/Ctrl+V anywhere on the section)
 *
 * AliExpress image-search returns the top 12 similar products with
 * prices + ratings. Closes the "they sell this, find the supplier"
 * loop in one step.
 */

interface AliProductLite {
  productId: number;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  priceMin: number;
  priceMax: number;
  currency: string;
  rating?: number;
  orderCount?: number;
  shopName?: string;
}

interface ImageSearchResult {
  totalResults: number;
  products: AliProductLite[];
}

// 5MB cap on uploaded image (matches the AE-side limit). Validated
// at three layers: client (here), API route schema, AE service.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function ImageHuntSection() {
  // URL input mode
  const [urlInput, setUrlInput] = useState("");
  // Direct-image mode (file upload / clipboard paste)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{
    name: string;
    sizeBytes: number;
  } | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImageSearchResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Document-level paste handler so the user can press Cmd/Ctrl+V
  // anywhere on the section (not just inside a focused field).
  // Triggers when at least one clipboard item is an image.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (loading) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void loadFile(file);
            return;
          }
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [loading]);

  async function loadFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      toast.error("That doesn't look like an image", {
        description: `File type "${file.type || "unknown"}" not supported.`,
      });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Image too large", {
        description: `${(file.size / 1024 / 1024).toFixed(1)} MB — max 5 MB.`,
      });
      return;
    }
    try {
      const dataUrl = await readFileAsDataURL(file);
      setPreviewSrc(dataUrl);
      setImageBase64(dataUrl); // includes the data URI prefix; backend strips it
      setImageMeta({
        name: file.name || "pasted-image",
        sizeBytes: file.size,
      });
      // Clear URL input when we get a file-based image — they're
      // mutually exclusive search inputs.
      setUrlInput("");
      setResult(null);
    } catch (err) {
      toast.error("Couldn't read the image", {
        description: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  function handleClearImage(): void {
    setPreviewSrc(null);
    setImageBase64(null);
    setImageMeta(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSearch(): Promise<void> {
    if (loading) return;
    // Prefer the uploaded/pasted image if present; otherwise URL.
    const useBase64 = !!imageBase64;
    const useUrl = !useBase64 && urlInput.trim().length >= 8;
    if (!useBase64 && !useUrl) return;

    setLoading(true);
    setResult(null);
    try {
      const body = useBase64
        ? { imageBase64 }
        : { imageUrl: urlInput.trim() };
      const res = await fetch("/api/aliexpress/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error(
            "AliExpress not connected — use the Connect button above.",
          );
        }
        throw new Error(respBody?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as ImageSearchResult;
      setResult(data);
      toast.success(`Found ${data.products.length} similar products`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error("Image search failed", { description: msg });
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
  }

  const canSearch =
    !loading && (!!imageBase64 || urlInput.trim().length >= 8);

  return (
    <div className="space-y-5">
      {/* Input card */}
      <Card className="border border-border/60 shadow-none">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 ring-1 ring-violet-500/30 flex items-center justify-center shadow shadow-violet-500/30">
              <ImageIcon className="size-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-600 dark:text-violet-400">
                Find the supplier
              </p>
              <h3 className="text-[16px] font-bold leading-tight">
                Upload, paste, or link an image
              </h3>
            </div>
          </div>

          {/* Drop zone / file picker / preview */}
          {previewSrc ? (
            <ImagePreviewBlock
              src={previewSrc}
              meta={imageMeta}
              onClear={handleClearImage}
            />
          ) : (
            <DropZone
              dragOver={dragOver}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onPickClick={() => fileInputRef.current?.click()}
            />
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFilePick}
          />

          {/* Divider — only when no image is loaded yet */}
          {!previewSrc && (
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              <div className="flex-1 border-t border-border/40" />
              <span>or paste a URL</span>
              <div className="flex-1 border-t border-border/40" />
            </div>
          )}

          {/* URL input — disabled when image is already loaded */}
          {!previewSrc && (
            <>
              <Input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSearch) handleSearch();
                }}
                placeholder="https://i.etsystatic.com/.../image.jpg"
                disabled={loading}
                className="h-12 text-sm bg-muted/20 border-border/70 focus-visible:border-violet-500/60 focus-visible:ring-violet-500/15"
              />
              <p className="text-[11px] text-muted-foreground/80">
                Right-click any competitor&apos;s Etsy listing image →
                &ldquo;Copy Image Address&rdquo; → paste here.
              </p>
            </>
          )}

          <Button
            type="button"
            onClick={handleSearch}
            disabled={!canSearch}
            className="w-full h-12 bg-gradient-to-r from-violet-500 to-pink-500 hover:opacity-90 text-white font-bold rounded-xl shadow-lg shadow-violet-500/30 disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Searching AliExpress by image…
              </>
            ) : (
              <>
                <Sparkles className="size-4 mr-2" />
                Find similar on AliExpress
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && result.products.length === 0 && (
        <Card className="border border-border/60">
          <CardContent className="p-8 text-center">
            <ImageIcon className="size-7 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm font-bold">No similar products found</p>
            <p className="text-[12px] text-muted-foreground mt-1">
              Try a clearer image or a different angle.
            </p>
          </CardContent>
        </Card>
      )}

      {result && result.products.length > 0 && (
        <Card className="border border-border/60 shadow-none">
          <CardContent className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-400 mb-3">
              {result.products.length} similar products on AliExpress
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {result.products.map((p) => (
                <a
                  key={p.productId}
                  href={p.productUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-2.5 rounded-lg ring-1 ring-border/50 bg-card hover:bg-muted/30 transition-colors p-2.5"
                >
                  <div className="size-16 rounded-md bg-muted/40 overflow-hidden shrink-0">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Package className="size-5 m-auto text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] leading-snug line-clamp-2">
                      {p.title}
                    </p>
                    <p className="text-[12px] font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                      ${p.priceMin.toFixed(2)}
                    </p>
                    {p.rating !== undefined && (
                      <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5 inline-flex items-center gap-0.5">
                        <Star
                          className="size-2.5 text-amber-500"
                          fill="currentColor"
                          strokeWidth={0}
                        />
                        {p.rating.toFixed(1)}
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Drop zone ──────────────────────────────────────────────────────

function DropZone({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickClick,
}: {
  dragOver: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickClick: () => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onPickClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPickClick();
        }
      }}
      className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer text-center px-6 py-8 ${
        dragOver
          ? "border-violet-500 bg-violet-500/10"
          : "border-border/60 hover:border-violet-500/60 hover:bg-violet-500/5"
      }`}
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className={`size-12 rounded-xl flex items-center justify-center ${
            dragOver
              ? "bg-violet-500 text-white"
              : "bg-violet-500/15 text-violet-600 dark:text-violet-400"
          }`}
        >
          <Upload className="size-6" />
        </div>
        <p className="text-sm font-bold">
          {dragOver ? "Drop the image to upload" : "Click to upload an image"}
        </p>
        <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
          <ClipboardPaste className="size-3" />
          or paste from clipboard (⌘V / Ctrl+V)
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          PNG, JPG, WEBP · max 5 MB
        </p>
      </div>
    </div>
  );
}

// ─── Preview block (after image loaded) ─────────────────────────────

function ImagePreviewBlock({
  src,
  meta,
  onClear,
}: {
  src: string;
  meta: { name: string; sizeBytes: number } | null;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl ring-1 ring-violet-500/30 bg-violet-500/5 p-3 flex items-center gap-3">
      <div className="size-24 rounded-lg overflow-hidden bg-muted/40 shrink-0 ring-1 ring-border/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="size-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold truncate">
          {meta?.name ?? "Image ready"}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {meta ? `${(meta.sizeBytes / 1024).toFixed(0)} KB` : ""}
        </p>
        <p className="text-[10px] text-violet-700 dark:text-violet-400 mt-1 font-bold uppercase tracking-wider">
          Ready to search
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="size-8 rounded-md hover:bg-rose-500/15 hover:text-rose-600 inline-flex items-center justify-center text-muted-foreground transition-colors shrink-0"
        title="Remove image"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Unexpected reader result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}
