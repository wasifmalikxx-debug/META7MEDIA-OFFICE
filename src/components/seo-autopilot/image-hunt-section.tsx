"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Sparkles,
  Image as ImageIcon,
  Package,
  Star,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Image Hunt section — lives inside the Product Hunter hub.
 *
 * Paste any image URL (e.g. a competitor's Etsy listing image) →
 * AliExpress image search returns the top 12 similar products with
 * prices and ratings. Closes the "they sell this, find the supplier"
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

export function ImageHuntSection({
  isCeo = false,
}: {
  /** CEO sees AE prices on result cards; employees don't (CEO ask
   * May 17 2026 — hide sourcing-cost info from team). */
  isCeo?: boolean;
} = {}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImageSearchResult | null>(null);

  async function handleSearch() {
    if (input.trim().length < 8 || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/aliexpress/image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: input.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error(
            "AliExpress not connected — use the Connect button above.",
          );
        }
        throw new Error(body?.error ?? `Failed (${res.status})`);
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
                Paste an image URL (an Etsy listing image works great)
              </h3>
            </div>
          </div>

          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim().length >= 8 && !loading)
                handleSearch();
            }}
            placeholder="https://i.etsystatic.com/.../image.jpg"
            disabled={loading}
            className="h-12 text-sm bg-muted/20 border-border/70 focus-visible:border-violet-500/60 focus-visible:ring-violet-500/15"
          />
          <p className="text-[11px] text-muted-foreground/80">
            Right-click any competitor&apos;s Etsy listing image →
            &ldquo;Copy Image Address&rdquo; → paste here. AliExpress
            will find products that look like it.
          </p>

          <Button
            type="button"
            onClick={handleSearch}
            disabled={input.trim().length < 8 || loading}
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
                    {/* AE price CEO-only. Rating stays visible (quality
                        signal, not a cost). */}
                    {isCeo && (
                      <p className="text-[12px] font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                        ${p.priceMin.toFixed(2)}
                      </p>
                    )}
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
