"use client";

import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Bell, HelpCircle, LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NavUser } from "@/components/layout/nav-config";

/**
 * Account menu — the round avatar at the far right of the top bar.
 *
 * Moved out of the sidebar footer on CEO instruction (Aug 2026): identity and
 * sign-out belong in the top-right corner, and the sidebar is left as pure
 * navigation.
 *
 * Layout is the CEO's reference: person-glyph avatar, then name + email with a
 * chip, then icon rows in groups, then a red sign-out. The reference's own rows
 * (Pricing, Billing, Upgrade plan, Language) are deliberately NOT copied — this
 * app sells nothing and has one language. Only pages that already exist are
 * listed, so nothing here can lead to a dead end.
 *
 * The chip holds the EMPLOYEE ID where the reference has an account tier. The
 * role went there first; the CEO replaced it — the ID is what fines, payroll
 * and reports are all keyed on, so it's the identifier people actually quote.
 *
 * Colours are ours, not the reference's terracotta: the avatar is a --muted
 * disc with a --border ring, which is the same treatment every other icon
 * button in the header uses.
 */

export function UserMenu({ user }: { user: NavUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        title={user.employeeId ? `${user.name} · ${user.employeeId}` : user.name}
        className={cn(
          "ml-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
          "bg-muted text-muted-foreground ring-1 ring-border outline-none",
          "transition-colors duration-200 ease-out",
          "hover:bg-accent hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring",
          "data-open:bg-accent data-open:text-foreground",
          "data-popup-open:bg-accent data-popup-open:text-foreground",
        )}
      >
        <User className="size-4" />
      </DropdownMenuTrigger>

      {/* Without an explicit width this inherits w-(--anchor-width) — the
          32px avatar. 18rem is the narrowest that still fits a full work
          address beside the role chip. */}
      <DropdownMenuContent align="end" sideOffset={8} className="w-72 p-1.5">
        {/* Identity */}
        <div className="flex items-center gap-2.5 px-1.5 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
            <User className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold leading-tight text-foreground">
              {user.name}
            </span>
            <span className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
              {user.email}
            </span>
          </div>
          {/* The employee ID, not the role — CEO's call. It's the handle the
              whole app keys off (fines, payroll, reports), so it's the one
              thing worth carrying over from the old sidebar footer. */}
          {user.employeeId && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground">
              {user.employeeId}
            </span>
          )}
        </div>

        {/* -mx-1.5 matches this menu's p-1.5, so the rule runs edge to edge
            like the reference's. The component default (-mx-1) leaves a 2px
            notch at each end. */}
        <DropdownMenuSeparator className="-mx-1.5" />

        <DropdownMenuItem render={<Link href="/profile" />} className="gap-3 px-2 py-2">
          <User className="size-4 text-muted-foreground" />
          My Profile
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/notifications" />} className="gap-3 px-2 py-2">
          <Bell className="size-4 text-muted-foreground" />
          Notifications
        </DropdownMenuItem>

        <DropdownMenuSeparator className="-mx-1.5" />

        <DropdownMenuItem render={<Link href="/how-it-works" />} className="gap-3 px-2 py-2">
          <HelpCircle className="size-4 text-muted-foreground" />
          How It Works
        </DropdownMenuItem>

        <DropdownMenuSeparator className="-mx-1.5" />

        <DropdownMenuItem
          variant="destructive"
          className="gap-3 px-2 py-2"
          onClick={async () => {
            await signOut({ redirect: false });
            window.location.href = "/login";
          }}
        >
          <LogOut className="size-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
