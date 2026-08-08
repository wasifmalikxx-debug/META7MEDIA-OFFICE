"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildNav, flattenNav, type NavUser } from "@/components/layout/nav-config";

/** Runaway guard for the result list — see the comment in `results`. */
const MAX_RESULTS = 200;

/**
 * ⌘K navigation palette.
 *
 * Purely a jump-to-page tool: it lists the exact same entries the sidebar
 * built for this user, so it can never route someone to a page their role
 * can't open. No data is fetched and no action is performed here.
 */
export function CommandPalette({
  user,
  open,
  onOpenChange,
}: {
  user: NavUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const entries = React.useMemo(() => flattenNav(buildNav(user)), [user]);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    // The cap is a runaway guard, not a feature. It must stay comfortably
    // above the largest real nav — a CEO already has 39 leaf entries, so the
    // old limit of 40 was one new page away from silently hiding Settings.
    if (!q) return entries.slice(0, MAX_RESULTS);
    return entries
      .map((e) => {
        const title = e.title.toLowerCase();
        const group = (e.group ?? "").toLowerCase();
        // Prefix match on the title beats a mid-word hit, which beats a
        // match that only appears in the group label.
        let score = -1;
        if (title.startsWith(q)) score = 0;
        else if (title.includes(q)) score = 1;
        else if (group.includes(q)) score = 2;
        return { e, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.e);
  }, [entries, query]);

  // Reset on every open so the palette never reopens mid-search.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  // NOTE: focus restore is deliberately NOT done here. Capturing
  // document.activeElement in an effect is too late — React runs the
  // <input autoFocus> mount in the layout phase, before any passive effect,
  // so we would only ever capture the palette's own input. The owner
  // (header.tsx) records the trigger before it opens us.

  React.useEffect(() => {
    setCursor(0);
  }, [query]);

  // Keep the highlighted row in view while arrowing through a long list.
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onOpenChange(false);
          } else if (e.key === "Tab") {
            // aria-modal only *claims* modality — nothing enforces it. Results
            // are reached with the arrow keys, so the input is the sole tab
            // stop and Tab must not walk into the page behind the backdrop.
            e.preventDefault();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => (results.length === 0 ? 0 : (c + 1) % results.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => (results.length === 0 ? 0 : (c - 1 + results.length) % results.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const hit = results[cursor];
            if (hit) go(hit.href);
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page…"
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="shell-scroll max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              No page matches “{query}”.
            </p>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={`${item.id}-${i}`}
                  type="button"
                  data-index={i}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => go(item.href)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                    i === cursor ? "bg-accent text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {item.title}
                  </span>
                  {item.group && (
                    <span className="shrink-0 truncate text-[11px] text-muted-foreground">
                      {item.group}
                    </span>
                  )}
                  {i === cursor && (
                    <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
