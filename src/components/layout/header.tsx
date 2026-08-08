"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { CommandPalette } from "@/components/layout/command-palette";
import { useShell } from "@/components/layout/shell";
import { routeTitle, type NavUser } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

/**
 * Top bar: sidebar collapse, breadcrumb, page search, alerts, theme.
 *
 * Height is locked to the sidebar's workspace card (h-14) so the two bottom
 * borders form one continuous line across the app.
 */
export function Header({ user }: { user: NavUser }) {
  const { pinned, togglePinned, setMobileOpen } = useShell();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Whatever had focus when the palette opened, so we can hand it back on
  // close. This has to be captured HERE, before the palette mounts — its
  // autoFocus input claims focus during React's layout phase, so anything
  // reading document.activeElement from inside the palette is already too
  // late and would only ever find the palette's own input.
  const paletteTrigger = React.useRef<HTMLElement | null>(null);

  const openPalette = React.useCallback(() => {
    paletteTrigger.current = document.activeElement as HTMLElement | null;
    setPaletteOpen(true);
  }, []);

  const handlePaletteOpenChange = React.useCallback((next: boolean) => {
    setPaletteOpen(next);
    if (!next) paletteTrigger.current?.focus?.();
  }, []);

  // ⌘K / Ctrl-K anywhere in the app.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((prev) => {
          if (prev) {
            paletteTrigger.current?.focus?.();
            return false;
          }
          paletteTrigger.current = document.activeElement as HTMLElement | null;
          return true;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = routeTitle(pathname);
  const workspace = user.officeName || "META7MEDIA";

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 md:px-4">
        {/* Collapse (desktop) */}
        <button
          type="button"
          onClick={togglePinned}
          aria-label={pinned ? "Collapse sidebar" : "Expand sidebar"}
          title={pinned ? "Collapse sidebar" : "Expand sidebar"}
          className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
        >
          {pinned ? (
            <PanelLeftClose className="size-[18px]" />
          ) : (
            <PanelLeftOpen className="size-[18px]" />
          )}
        </button>

        {/* Drawer (mobile) */}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
        >
          <Menu className="size-[18px]" />
        </button>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <span className="hidden truncate text-muted-foreground sm:inline">{workspace}</span>
          <span className="hidden text-muted-foreground/40 sm:inline">/</span>
          <span className="truncate font-medium text-foreground">{title}</span>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Search — a button dressed as an input, opening the ⌘K palette. */}
          <button
            type="button"
            onClick={openPalette}
            className={cn(
              "hidden h-8 items-center gap-2 rounded-lg border border-border bg-background/60 pl-2.5 pr-2 text-[13px] text-muted-foreground",
              "transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground lg:inline-flex lg:w-56",
            )}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="shrink-0 rounded border border-border px-1 py-px font-mono text-[10px] leading-none">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
          >
            <Search className="size-4" />
          </button>

          <NotificationsBell />
          <ThemeToggle />
          {/* Account lives here, in the far corner — not in the sidebar
              footer, where the rail clipped it to an anonymous circle. */}
          <UserMenu user={user} />
        </div>
      </header>

      <CommandPalette user={user} open={paletteOpen} onOpenChange={handlePaletteOpenChange} />
    </>
  );
}
