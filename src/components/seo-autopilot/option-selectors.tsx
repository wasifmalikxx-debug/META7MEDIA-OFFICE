"use client";

import { useState } from "react";
import { X, Plus, ChevronDown, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Size + Variant pickers for SEO Autopilot — clean redesign (May 14).
 *
 * The previous version had big tabbed preset grids that dominated the
 * UI. This version puts the chip-input FIRST and pushes presets behind
 * tiny "quick add" affordances. Most employees just type what they need.
 */

// ─── Shared chip box (typed values + click-to-remove chips) ─────────

function ChipBox({
  values,
  onChange,
  placeholder,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const tokens = raw
      .split(/[,\n]/)
      .map((t) => t.trim())
      // Hard-cap each token at 100 chars to match the server schema.
      // Pasted strings (e.g. an AliExpress size description copy-paste)
      // can run far longer than 100 chars; we trim defensively here.
      .map((t) => (t.length > 100 ? t.slice(0, 100) : t))
      .filter(Boolean);
    if (tokens.length === 0) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const t of tokens) {
      if (!seen.has(t.toLowerCase()) && next.length < 30) {
        next.push(t);
        seen.add(t.toLowerCase());
      }
    }
    onChange(next);
    setDraft("");
  }

  function removeAt(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }

  return (
    <div className="rounded-xl border bg-card px-2.5 py-2 min-h-[44px] flex flex-wrap gap-1.5 items-center transition-colors focus-within:border-orange-500/40 focus-within:ring-1 focus-within:ring-orange-500/20">
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-foreground text-background px-2.5 py-0.5 text-[11px] font-semibold"
        >
          {v}
          <button
            type="button"
            onClick={() => removeAt(i)}
            disabled={disabled}
            className="hover:text-rose-300 disabled:opacity-50"
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
        // 100-char cap matches the server-side Zod schema. Browsers hard-stop
        // typing at this length, so employees can't accidentally trigger
        // a "too long" validation error on the generate API.
        maxLength={100}
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground/60 py-1"
      />
    </div>
  );
}

// ─── Bulk add helper ────────────────────────────────────────────────

function mergeUnique(current: string[], additions: string[]): string[] {
  const seen = new Set(current.map((v) => v.toLowerCase()));
  const next = [...current];
  for (const a of additions) {
    if (!seen.has(a.toLowerCase()) && next.length < 30) {
      next.push(a);
      seen.add(a.toLowerCase());
    }
  }
  return next;
}

// ─── Size selector ──────────────────────────────────────────────────

interface SizePreset {
  label: string;
  values: string[];
}

const SIZE_QUICK_PRESETS: SizePreset[] = [
  { label: "XS-XL", values: ["XS", "S", "M", "L", "XL"] },
  {
    label: "XS-XXXL",
    values: ["XS", "S", "M", "L", "XL", "XXL", "XXXL"],
  },
  {
    label: "0-22",
    values: ["0", "2", "4", "6", "8", "10", "12", "14", "16", "18", "20", "22"],
  },
  {
    label: "28-44 waist",
    values: ["28", "30", "32", "34", "36", "38", "40", "42", "44"],
  },
  {
    label: "Newborn-24M",
    values: ["Newborn", "0-3M", "3-6M", "6-12M", "12-18M", "18-24M"],
  },
  { label: "2T-5T", values: ["2T", "3T", "4T", "5T"] },
  {
    label: "Kids 4-16",
    values: ["4", "5", "6", "7", "8", "10", "12", "14", "16"],
  },
  {
    label: "Shoes 5-12",
    values: ["5", "6", "7", "8", "9", "10", "11", "12"],
  },
  {
    label: "Ring 4-13",
    values: ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13"],
  },
  { label: "One Size", values: ["One Size"] },
];

export function SizeSelector({
  values,
  onChange,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <ChipBox
        values={values}
        onChange={onChange}
        placeholder="Type a size, press Enter — or use quick add below"
        disabled={disabled}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-[0.14em] mr-1">
          Quick add
        </span>
        {SIZE_QUICK_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(mergeUnique(values, preset.values))}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full bg-muted/40 hover:bg-orange-100 dark:hover:bg-orange-950/30 hover:text-orange-700 dark:hover:text-orange-300 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed ring-1 ring-transparent hover:ring-orange-500/30"
          >
            <Plus className="size-2.5" />
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Variant selector ───────────────────────────────────────────────
//
// Replaces the previous ColorSelector. Renamed because variants can be
// anything: colors, phone models, designs, materials, scents.
// Colours get a popover-based palette as their only preset since they
// happen most often.

interface ColorPreset {
  name: string;
  hex: string;
}

const COLOR_PRESETS: ColorPreset[] = [
  // Neutrals
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Ivory", hex: "#FFFFF0" },
  { name: "Cream", hex: "#FFFDD0" },
  { name: "Gray", hex: "#808080" },
  { name: "Charcoal", hex: "#36454F" },
  // Warm neutrals
  { name: "Beige", hex: "#F5F5DC" },
  { name: "Tan", hex: "#D2B48C" },
  { name: "Khaki", hex: "#C3B091" },
  { name: "Brown", hex: "#8B5A2B" },
  // Reds / pinks
  { name: "Red", hex: "#DC2626" },
  { name: "Burgundy", hex: "#800020" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Hot Pink", hex: "#FF1493" },
  { name: "Coral", hex: "#FF7F50" },
  { name: "Blush", hex: "#DE9596" },
  // Orange / yellow
  { name: "Orange", hex: "#F97316" },
  { name: "Peach", hex: "#FFDAB9" },
  { name: "Yellow", hex: "#EAB308" },
  { name: "Gold", hex: "#D4A574" },
  { name: "Mustard", hex: "#FFDB58" },
  // Greens
  { name: "Green", hex: "#16A34A" },
  { name: "Mint", hex: "#98FF98" },
  { name: "Sage", hex: "#BCB88A" },
  { name: "Olive", hex: "#808000" },
  { name: "Emerald", hex: "#10B981" },
  // Blues
  { name: "Blue", hex: "#2563EB" },
  { name: "Navy", hex: "#1E3A5F" },
  { name: "Sky Blue", hex: "#87CEEB" },
  { name: "Turquoise", hex: "#40E0D0" },
  { name: "Teal", hex: "#0D9488" },
  // Purples
  { name: "Purple", hex: "#9333EA" },
  { name: "Lavender", hex: "#E6E6FA" },
  { name: "Lilac", hex: "#C8A2C8" },
  // Metallics + special
  { name: "Silver", hex: "#C0C0C0" },
  { name: "Rose Gold", hex: "#B76E79" },
  {
    name: "Multicolor",
    hex: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #10b981)",
  },
];

// ─── Numbered designs preset counts ─────────────────────────────────

const DESIGN_COUNT_PRESETS = [4, 6, 8, 10, 12, 14, 16, 20];

/**
 * Idempotently expand the variant list to include "Design 1" through
 * "Design N". Existing Design-N chips are left in place; missing ones
 * are appended in order. So clicking "14" when the chip box has Design
 * 1-5 will add 6-14.
 */
function ensureDesignCount(existing: string[], target: number): string[] {
  const existingNumbers = new Set<number>();
  for (const v of existing) {
    const m = v.match(/^Design\s+(\d+)$/i);
    if (m) existingNumbers.add(parseInt(m[1], 10));
  }
  const next = [...existing];
  for (let i = 1; i <= target; i++) {
    if (!existingNumbers.has(i)) next.push(`Design ${i}`);
  }
  return next;
}

export function VariantSelector({
  values,
  onChange,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <ChipBox
        values={values}
        onChange={onChange}
        placeholder="Type a variant, press Enter (e.g. Black · iPhone 14 · Minimalist · Design 1)"
        disabled={disabled}
      />
      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        Anything buyers can choose — colors, phone models, designs, materials, scents, styles.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-[0.14em] mr-1">
          Quick add
        </span>
        <ColorPickerPopover
          selectedValues={values}
          onChange={onChange}
          disabled={disabled}
        />
        <NumberedDesignsPopover
          existing={values}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function ColorPickerPopover({
  selectedValues,
  onChange,
  disabled,
}: {
  selectedValues: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedValues.map((v) => v.toLowerCase()));

  function toggle(name: string) {
    const lower = name.toLowerCase();
    if (selected.has(lower)) {
      onChange(selectedValues.filter((v) => v.toLowerCase() !== lower));
    } else if (selectedValues.length < 30) {
      onChange([...selectedValues, name]);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full bg-muted/50 hover:bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          />
        }
      >
        <Plus className="size-2.5" />
        Common colors
        <ChevronDown className="size-2.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-3">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Pick one or more — click to add / remove
          </p>
          <div className="grid grid-cols-3 gap-1.5 max-h-72 overflow-y-auto">
            {COLOR_PRESETS.map((c) => {
              const isSelected = selected.has(c.name.toLowerCase());
              const isMulti = c.name === "Multicolor";
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => toggle(c.name)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors text-left ${
                    isSelected
                      ? "bg-foreground text-background ring-1 ring-foreground"
                      : "bg-card border border-border hover:bg-muted/40 text-foreground/85"
                  }`}
                >
                  <span
                    className={`size-3.5 rounded-full shrink-0 ${
                      c.name === "White" && !isSelected
                        ? "ring-1 ring-border"
                        : isSelected
                          ? "ring-1 ring-background/50"
                          : ""
                    }`}
                    style={
                      isMulti
                        ? { background: c.hex }
                        : { backgroundColor: c.hex }
                    }
                  />
                  <span className="truncate flex-1">{c.name}</span>
                  {isSelected && <Check className="size-2.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Numbered designs popover ──────────────────────────────────────
//
// For products with N unique pattern variants that don't have proper
// names (typical AliExpress dropship case — Hawaiian shirts, phone
// cases, mugs). Click a count, get "Design 1" through "Design N"
// added to the chip box. Closes after a count is picked.

function NumberedDesignsPopover({
  existing,
  onChange,
  disabled,
}: {
  existing: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customCount, setCustomCount] = useState("");

  function applyCount(n: number) {
    if (n < 1 || n > 50) return;
    onChange(ensureDesignCount(existing, n));
    setOpen(false);
    setCustomCount("");
  }

  function applyCustom() {
    const parsed = parseInt(customCount, 10);
    if (Number.isFinite(parsed)) applyCount(parsed);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full bg-muted/40 hover:bg-orange-100 dark:hover:bg-orange-950/30 hover:text-orange-700 dark:hover:text-orange-300 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors disabled:opacity-50 ring-1 ring-transparent hover:ring-orange-500/30"
          />
        }
      >
        <Plus className="size-2.5" />
        Numbered designs
        <ChevronDown className="size-2.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-3 space-y-3">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.16em]">
            How many designs?
          </p>
          <p className="text-[10px] text-muted-foreground/70 leading-snug mt-0.5">
            Adds &ldquo;Design 1&rdquo; through &ldquo;Design N&rdquo; — for products
            with multiple unique patterns.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {DESIGN_COUNT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => applyCount(n)}
              className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-border bg-card hover:bg-orange-50 dark:hover:bg-orange-950/30 hover:border-orange-500/40 transition-colors tabular-nums"
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1 border-t">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Custom
          </span>
          <input
            type="number"
            min={1}
            max={50}
            value={customCount}
            onChange={(e) => setCustomCount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustom();
              }
            }}
            placeholder="e.g. 27"
            className="flex-1 h-7 px-2 rounded-md border border-input bg-card text-xs tabular-nums placeholder:text-muted-foreground/60 outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customCount.trim()}
            className="px-2.5 h-7 rounded-md bg-foreground text-background text-[11px] font-semibold disabled:opacity-30"
          >
            Add
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
