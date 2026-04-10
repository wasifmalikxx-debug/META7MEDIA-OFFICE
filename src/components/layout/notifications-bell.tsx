"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  linkUrl?: string | null;
  createdAt: string;
}

// Slow polling to avoid hammering Supabase the way the complaint chat used to.
// Visible tab: every 60s. Hidden tab: paused entirely.
const POLL_INTERVAL_MS = 60_000;

export function NotificationsBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const visibleRef = useRef(typeof document !== "undefined" ? !document.hidden : true);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") setUnread(data.count);
    } catch {
      // silently ignore polling errors — bell just won't update this tick
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setItems(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial count + poll while tab visible
  useEffect(() => {
    fetchUnreadCount();

    const tick = () => {
      if (visibleRef.current) fetchUnreadCount();
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);

    const onVisibility = () => {
      visibleRef.current = !document.hidden;
      // Refresh immediately when tab becomes visible again
      if (visibleRef.current) fetchUnreadCount();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchUnreadCount]);

  // Load list when popover opens
  useEffect(() => {
    if (open) fetchItems();
  }, [open, fetchItems]);

  async function markOne(id: string, linkUrl?: string | null) {
    // Optimistic
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // ignore — next poll will reconcile
    }
    if (linkUrl) {
      setOpen(false);
      router.push(linkUrl);
    }
  }

  async function markAllRead() {
    if (unread === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
    } catch {
      // ignore — next poll will reconcile
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-center size-8 p-0 relative rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[340px] p-0 gap-0 max-h-[480px] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">
                {unread}
              </span>
            )}
          </div>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-[11px] font-medium text-primary hover:underline flex items-center gap-1"
            >
              <CheckCheck className="size-3" />
              Mark all read
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1">
          {loading && items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <ul className="divide-y">
              {items.slice(0, 12).map((n) => (
                <li
                  key={n.id}
                  onClick={() => markOne(n.id, n.linkUrl)}
                  className={`px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/40 ${
                    !n.isRead ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 size-1.5 rounded-full flex-shrink-0 ${
                        !n.isRead ? "bg-primary" : "bg-transparent"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${!n.isRead ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                        {n.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {format(new Date(n.createdAt), "MMM d, hh:mm a")}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-4 py-2">
          <button
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            className="w-full text-[11px] font-medium text-center text-muted-foreground hover:text-foreground transition-colors"
          >
            View all notifications →
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
