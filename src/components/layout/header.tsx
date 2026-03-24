"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="flex h-14 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />
      {title && <h1 className="text-sm font-medium">{title}</h1>}
    </header>
  );
}
