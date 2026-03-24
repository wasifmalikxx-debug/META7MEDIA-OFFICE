"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  title?: string;
  unreadCount?: number;
}

export function Header({ title, unreadCount = 0 }: HeaderProps) {
  return (
    <header className="flex h-14 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />
      {title && <h1 className="text-sm font-medium">{title}</h1>}
      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/notifications"
          className="relative inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 size-4 p-0 text-[10px] flex items-center justify-center"
            >
              {unreadCount}
            </Badge>
          )}
        </Link>
      </div>
    </header>
  );
}
