"use client";

import { useState } from "react";
import { Loader2, Plus, X, Tag, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Niche manager modal.
 *
 * Opened from the page header. Lets the seller add/remove niches
 * (cap 5). Suggestions appear as one-click chips. Adds + deletes
 * are immediate against the API — when the modal closes, the parent
 * re-fetches the trending feed.
 *
 * Suggested niches are hard-coded in the service file, NOT fetched —
 * they're a curated UX nicety, not a domain concept.
 */

export interface NicheRow {
  id: string;
  niche: string;
}

const SUGGESTED: ReadonlyArray<string> = [
  "boho jewelry",
  "minimalist jewelry",
  "cottagecore decor",
  "farmhouse wall art",
  "minimalist nursery",
  "baby shower gifts",
  "witchy decor",
  "bridesmaid gifts",
  "anniversary gift",
  "personalized keychain",
  "silver jewelry",
  "travel mug",
  "candle holder",
  "kitchen wall art",
  "boho wall hanging",
  "macrame decor",
  "leather wallet",
  "embroidered hat",
  "pet portrait",
  "garden decor",
  "yoga gift",
  "teacher appreciation",
];

export function NicheManagerModal({
  open,
  onOpenChange,
  niches,
  cap,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  niches: NicheRow[];
  cap: number;
  /** Called after every successful add/remove so the parent re-fetches. */
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const atCap = niches.length >= cap;
  const usedSet = new Set(niches.map((n) => n.niche.toLowerCase()));
  const suggestedFiltered = SUGGESTED.filter((s) => !usedSet.has(s));

  async function handleAdd(value: string) {
    const niche = value.trim();
    if (!niche || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/employee-niches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      toast.success(`Added "${niche}"`, {
        description:
          "First batch arrives in tomorrow's 5 AM PKT cron run.",
      });
      setDraft("");
      onChanged();
    } catch (err) {
      toast.error("Couldn't add niche", {
        description: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string, label: string) {
    if (removingId) return;
    setRemovingId(id);
    try {
      const res = await fetch(`/api/employee-niches/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      toast.success(`Removed "${label}"`);
      onChanged();
    } catch (err) {
      toast.error("Couldn't remove niche", {
        description: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4 text-orange-600 dark:text-orange-400" />
            Manage your niches
          </DialogTitle>
          <DialogDescription>
            Up to {cap} niches. New niches start producing trends in tomorrow&apos;s
            5 AM PKT batch.
          </DialogDescription>
        </DialogHeader>

        {/* Current niches */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Your niches ({niches.length} / {cap})
            </p>
          </div>
          {niches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-center text-[12px] text-muted-foreground">
              No niches yet. Add one below to get started.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {niches.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5"
                >
                  <span className="text-[13px] font-medium">{n.niche}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(n.id, n.niche)}
                    disabled={removingId === n.id}
                    className="size-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    title={`Remove "${n.niche}"`}
                    aria-label={`Remove "${n.niche}"`}
                  >
                    {removingId === n.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add new */}
        <div className="space-y-2 pt-2 border-t border-border/40">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Add a new niche
          </p>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd(draft);
              }}
              placeholder={atCap ? "Remove one first" : "e.g. boho jewelry"}
              disabled={busy || atCap}
              maxLength={80}
              className="h-9 text-sm"
            />
            <Button
              type="button"
              onClick={() => handleAdd(draft)}
              disabled={busy || atCap || draft.trim().length < 2}
              className="h-9"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <>
                  <Plus className="size-3.5 mr-1" />
                  Add
                </>
              )}
            </Button>
          </div>

          {/* Suggestions — only when not at cap and there are unused ones */}
          {!atCap && suggestedFiltered.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-3" />
                Suggested for you
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestedFiltered.slice(0, 12).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleAdd(s)}
                    disabled={busy}
                    className="text-[11px] px-2 py-1 rounded-full border border-border/60 bg-muted/40 hover:bg-muted hover:border-border transition-colors disabled:opacity-50"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
