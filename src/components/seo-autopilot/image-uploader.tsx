"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X, ImageIcon } from "lucide-react";

/**
 * Two-slot image uploader for SEO Autopilot.
 *
 * Each slot accepts drag-drop or click-to-browse. On selection:
 *   1. The image is read into a canvas.
 *   2. Resized to fit within 1280×1280 (preserves aspect).
 *   3. Re-encoded as JPEG at 0.85 quality.
 *   4. The base64 (without prefix) is sent up via onChange.
 *
 * Total payload after resize is ~150-400KB per image — comfortably
 * inside Vercel's 4.5MB request limit for two images plus the form.
 */

export interface UploadedImage {
  base64: string; // without "data:image/jpeg;base64," prefix
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  previewUrl: string; // data URL for the <img> tag
  filename: string;
}

// 768 fits inside one Anthropic vision tile (≤1568 px on the long edge
// still maps to a single tile but the tile token cost scales with the
// real pixel count). At 768 the trademark + product details remain
// clearly readable to Sonnet while we use ~half the vision tokens vs
// 1280. Empirically: ~$0.008 saved per generation.
const MAX_DIMENSION = 768;
const JPEG_QUALITY = 0.85;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function processFile(file: File): Promise<UploadedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(`${file.type || "Unknown"} is not supported — use JPG, PNG, WebP, or GIF.`);
  }
  // 12MB raw limit before resize — anything bigger is almost certainly a
  // RAW or oversized phone shot. After canvas resize we're safe.
  if (file.size > 12 * 1024 * 1024) {
    throw new Error(`${file.name} is too large (max 12 MB).`);
  }

  // Read into an Image element via FileReader → data URL.
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Failed to read file"));
    fr.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to decode image"));
    i.src = dataUrl;
  });

  // Resize preserving aspect ratio.
  let { width, height } = img;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser");
  ctx.drawImage(img, 0, 0, width, height);

  // Always re-encode as JPEG — Claude handles JPEG well and it compresses
  // the most. We keep PNG only when the source is small (probably an icon).
  const useJpeg = file.size > 200 * 1024 || file.type !== "image/png";
  const outType = useJpeg ? "image/jpeg" : "image/png";
  const outUrl = canvas.toDataURL(outType, useJpeg ? JPEG_QUALITY : undefined);
  const base64 = outUrl.split(",")[1] ?? "";

  return {
    base64,
    mediaType: outType as UploadedImage["mediaType"],
    previewUrl: outUrl,
    filename: file.name,
  };
}

interface SeoImageUploaderProps {
  images: UploadedImage[];
  onChange: (next: UploadedImage[]) => void;
  disabled?: boolean;
  maxImages?: number;
}

export function SeoImageUploader({
  images,
  onChange,
  disabled = false,
  maxImages = 2,
}: SeoImageUploaderProps) {
  return (
    <div className="grid gap-3 grid-cols-2">
      {Array.from({ length: maxImages }).map((_, idx) => (
        <UploadSlot
          key={idx}
          index={idx}
          image={images[idx]}
          disabled={disabled}
          onAdd={(img) => {
            const next = [...images];
            next[idx] = img;
            onChange(next.filter(Boolean));
          }}
          onRemove={() => {
            const next = images.filter((_, i) => i !== idx);
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function UploadSlot({
  index,
  image,
  disabled,
  onAdd,
  onRemove,
}: {
  index: number;
  image?: UploadedImage;
  disabled: boolean;
  onAdd: (img: UploadedImage) => void;
  onRemove: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      try {
        const processed = await processFile(file);
        onAdd(processed);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to process image");
      } finally {
        setBusy(false);
      }
    },
    [onAdd],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Clear so the same file can be re-picked.
    e.target.value = "";
  }

  if (image) {
    return (
      <div className="relative aspect-square rounded-lg overflow-hidden border bg-card group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.previewUrl}
          alt={image.filename}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
          <p className="text-[10px] text-white/90 truncate font-medium">
            {image.filename}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="absolute top-1.5 right-1.5 size-6 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove image"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors ${
        dragging
          ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30"
          : error
            ? "border-rose-400 bg-rose-50/40 dark:bg-rose-950/20"
            : "border-border bg-muted/20 hover:bg-muted/40 hover:border-muted-foreground/40"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={onPick}
        disabled={disabled || busy}
        className="sr-only"
      />
      {busy ? (
        <>
          <div className="size-7 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
          <p className="text-[10px] text-muted-foreground">Processing…</p>
        </>
      ) : error ? (
        <>
          <X className="size-5 text-rose-500" />
          <p className="text-[10px] text-rose-600 dark:text-rose-400 text-center px-2 leading-tight">
            {error}
          </p>
          <p className="text-[9px] text-muted-foreground/70 mt-0.5">
            Click to try another
          </p>
        </>
      ) : (
        <>
          <div className="size-9 rounded-lg bg-muted/60 flex items-center justify-center">
            {index === 0 ? (
              <ImageIcon className="size-4 text-muted-foreground" />
            ) : (
              <Upload className="size-4 text-muted-foreground" />
            )}
          </div>
          <p className="text-[11px] font-semibold text-foreground/80">
            {index === 0 ? "Primary image" : "Detail / angle"}
          </p>
          <p className="text-[9px] text-muted-foreground/70 text-center px-2 leading-tight">
            Click or drag · JPG/PNG/WebP
          </p>
        </>
      )}
    </label>
  );
}
