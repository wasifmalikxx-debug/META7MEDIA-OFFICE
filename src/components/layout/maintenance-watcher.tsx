"use client";

import { useEffect } from "react";

/**
 * Reloads the page when the portal's maintenance state flips.
 *
 * Two directions, one component:
 *   expect="off"  mounted inside the live portal for non-CEO users. When
 *                 maintenance turns ON, their already-open tab reloads and
 *                 the server hands back the notice.
 *   expect="on"   mounted on the notice itself. When maintenance turns OFF,
 *                 the tab reloads back into the working portal, so nobody is
 *                 left staring at a stale notice after the portal reopens.
 *
 * Never mounted for the CEO. He is exempt from the gate, so a reload would
 * return the portal, the watcher would poll again, and the tab would reload
 * forever.
 */
const POLL_MS = 30_000;

export function MaintenanceWatcher({ expect }: { expect: "on" | "off" }) {
  useEffect(() => {
    let stopped = false;

    async function check() {
      // Hidden tabs are skipped: nobody is reading them, and 35 idle tabs
      // polling is load for no benefit. The visibilitychange handler below
      // catches up the moment someone looks.
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/maintenance-status", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const { maintenance } = (await res.json()) as { maintenance: boolean };
        const changed = expect === "off" ? maintenance : !maintenance;
        if (changed) window.location.reload();
      } catch {
        // Offline or mid-deploy — try again on the next tick.
      }
    }

    const id = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    check();

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [expect]);

  return null;
}
