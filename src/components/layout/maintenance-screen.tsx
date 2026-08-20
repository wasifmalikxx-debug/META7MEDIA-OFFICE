"use client";

import { signOut } from "next-auth/react";
import { Lock, LogOut } from "lucide-react";

/**
 * Maintenance notice — what every non-CEO account sees while
 * MAINTENANCE_MODE=true.
 *
 * Rendered INSTEAD of the app shell, not on top of it: the dashboard layout
 * returns this before it builds the sidebar, header or page, so a locked-out
 * user's browser never receives any portal data to begin with. An overlay
 * would have left the real page sitting underneath in the DOM.
 *
 * Wording is the CEO's chosen version (E). Two things about it are deliberate
 * and should not be "improved" without asking him:
 *   - There is no reassurance line about pay or attendance. The calm version
 *     had one; he asked for a firmer notice and that sentence is what takes
 *     the weight out of it.
 *   - There is no primary action button. 35 people hit this screen at once,
 *     and a "Message the CEO" button turns that into 35 WhatsApp messages.
 *
 * Sign out stays, so nobody is stuck on a dead screen with no way off it.
 */
export function MaintenanceScreen({ name, employeeId }: { name: string; employeeId: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-[440px] rounded-2xl border border-border bg-card p-7 text-center shadow-2xl shadow-foreground/10">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:ring-rose-900">
          <Lock className="size-6" />
        </span>

        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Portal access is suspended
        </h1>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Access to the portal has been locked for all staff accounts until further notice. Do not
          share your login details with anyone. You will be told when access is restored.
        </p>

        <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
          Questions go to the CEO only.
        </p>

        <div className="mt-5 border-t border-border pt-4">
          <p className="text-[11px] text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{name}</span>
            {employeeId ? ` · ${employeeId}` : ""}
          </p>
          <button
            type="button"
            onClick={async () => {
              await signOut({ redirect: false });
              window.location.href = "/login";
            }}
            className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            <LogOut className="size-3" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
