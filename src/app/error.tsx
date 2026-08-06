"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useState, startTransition } from "react";
import { useRouter } from "next/navigation";

// Root error boundary — the "portal must never look down" net (Aug 2026).
// Catches any route error the per-page boundaries don't. Self-healing rules:
//
// 1. STALE-TAB CHUNK ERRORS: employees keep the portal open all day; after a
//    deploy, an old tab's next navigation can request JS chunks that no
//    longer exist (ChunkLoadError). Only a full reload picks up the new
//    build — done automatically, at most once per 30s so a genuinely broken
//    build can't reload-loop.
// 2. TRANSIENT SERVER BLIPS (DB pool spike, cold start): auto-retry with
//    router.refresh() + reset() — reset() alone does NOT refetch in Next 16
//    (the errored flight payload is cached and re-throws), so a refresh must
//    ride along or the retry is a no-op. Max 2 auto-attempts per 30s window
//    (tracked in sessionStorage — the boundary may not remount between
//    re-errors, and module state wouldn't survive a remount), then the
//    manual card. A failsafe timer guarantees the quiet "Reconnecting…"
//    state can never outlive its attempt.
const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

const RELOAD_GUARD_KEY = "m7_chunk_reload_at";
const AUTO_RETRY_KEY = "m7_auto_retry";

function guardedReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < 30_000) return false; // already tried recently
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    // Storage blocked (privacy mode) → fail CLOSED: no unguarded reload
    // (that would loop forever on a persistent chunk error). The manual
    // card's Reload button is the recovery path.
    return false;
  }
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [autoRetrying, setAutoRetrying] = useState(true);

  function retry() {
    // Refresh MUST accompany reset — see header comment.
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  // Keyed on [error]: each failed refreshed attempt produces a NEW error
  // object, re-firing this effect so the attempt counter progresses even
  // though the boundary may not remount.
  useEffect(() => {
    console.error("[app] route error:", error);

    if (CHUNK_ERROR_RE.test(`${error?.name ?? ""} ${error?.message ?? ""}`)) {
      if (!guardedReload()) setAutoRetrying(false);
      return;
    }

    let count = 0;
    let windowStart = Date.now();
    try {
      const raw = sessionStorage.getItem(AUTO_RETRY_KEY);
      if (raw) {
        const [c, w] = raw.split(":").map(Number);
        if (Date.now() - w < 30_000) {
          count = c;
          windowStart = w;
        }
      }
    } catch {}

    if (count >= 2) {
      setAutoRetrying(false);
      return;
    }
    try {
      sessionStorage.setItem(AUTO_RETRY_KEY, `${count + 1}:${windowStart}`);
    } catch {}

    setAutoRetrying(true);
    const delay = 1200 * (count + 1);
    const attempt = setTimeout(retry, delay);
    // Failsafe: if the retry doesn't unmount us (recovery) or re-fire this
    // effect (new error), surface the manual card rather than spin forever.
    const failsafe = setTimeout(() => setAutoRetrying(false), delay + 5000);
    return () => {
      clearTimeout(attempt);
      clearTimeout(failsafe);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // Quiet reconnecting state while auto-retrying — most blips resolve here
  // and the user never reads an error message.
  if (autoRetrying) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="size-5 animate-spin" />
          <span className="text-sm font-medium">Reconnecting…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="border-0 shadow-sm max-w-md w-full">
        <CardContent className="py-12 text-center">
          <div className="size-14 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
            <AlertTriangle className="size-7 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-sm font-semibold">Temporary connection hiccup</p>
          <p className="text-xs text-muted-foreground mt-1 mb-5 max-w-sm mx-auto">
            The server is busy right now — this usually clears within seconds.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              onClick={() => {
                try {
                  sessionStorage.removeItem(AUTO_RETRY_KEY);
                } catch {}
                setAutoRetrying(true);
                retry();
              }}
              variant="outline"
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              Try again
            </Button>
            <Button onClick={() => window.location.reload()} className="gap-2">
              Reload page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
