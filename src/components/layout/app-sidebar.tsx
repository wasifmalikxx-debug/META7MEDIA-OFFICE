"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Users,
  Building2,
  Wallet,
  AlertTriangle,
  Settings,
  User,
  LogOut,
  ShieldCheck,
  HelpCircle,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";



interface AppSidebarProps {
  user: {
    name: string;
    email: string;
    role: string;
    employeeId: string;
  };
}

const mainNav = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["all"] },
];

const managementNav = [
  { title: "Employees", href: "/employees", icon: Users, roles: ["SUPER_ADMIN"] },
  { title: "Departments", href: "/departments", icon: Building2, roles: ["SUPER_ADMIN"] },
  { title: "Login Approvals", href: "/login-approvals", icon: ShieldCheck, roles: ["SUPER_ADMIN"] },
];

const financeNav = [
  { title: "Payroll", href: "/payroll", icon: Wallet, roles: ["all"] },
  { title: "Fines", href: "/fines", icon: AlertTriangle, roles: ["all"] },
];

const settingsNav = [
  { title: "Settings", href: "/settings", icon: Settings, roles: ["SUPER_ADMIN"] },
  { title: "How It Works", href: "/how-it-works", icon: HelpCircle, roles: ["all"] },
];

function hasAccess(roles: string[], userRole: string) {
  return roles.includes("all") || roles.includes(userRole);
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const [pendingDevices, setPendingDevices] = useState(0);

  // Poll for pending device approvals every 30 seconds (CEO only)
  useEffect(() => {
    if (user.role !== "SUPER_ADMIN") return;
    async function fetchPending() {
      try {
        const res = await fetch("/api/device-approval");
        if (res.ok) {
          const devices = await res.json();
          setPendingDevices(devices.filter((d: any) => d.status === "PENDING").length);
        }
      } catch {}
    }
    fetchPending();
    const interval = setInterval(fetchPending, 30000);
    return () => clearInterval(interval);
  }, [user.role]);

  const renderNavItems = (items: typeof mainNav) =>
    items
      .filter((item) => hasAccess(item.roles, user.role))
      .map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton render={<Link href={item.href} />} isActive={pathname === item.href}>
              <item.icon className="size-4" />
              <span>{item.title}</span>
              {item.href === "/login-approvals" && pendingDevices > 0 && (
                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center">
                  {pendingDevices}
                </Badge>
              )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ));

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            M7
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">META7MEDIA</span>
            <span className="text-xs text-muted-foreground">Office Manager</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderNavItems(mainNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {managementNav.some((item) => hasAccess(item.roles, user.role)) && (
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(managementNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Finance</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderNavItems(financeNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {settingsNav.some((item) => hasAccess(item.roles, user.role)) && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(settingsNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton className="w-full" />}>
                  <Avatar className="size-6">
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start text-left">
                    <span className="text-sm">{user.name}</span>
                    <span className="text-xs text-muted-foreground">{user.employeeId}</span>
                  </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <DropdownMenuItem render={<Link href="/profile" />}>
                    <User className="mr-2 size-4" />
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  await signOut({ redirect: false });
                  window.location.href = "/login";
                }}>
                    <LogOut className="mr-2 size-4" />
                    Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
