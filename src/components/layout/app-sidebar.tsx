"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Clock,
  Calendar,
  Users,
  Building2,
  Wallet,
  Gift,
  AlertTriangle,
  ShieldAlert,
  Megaphone,
  BarChart3,
  Settings,
  User,
  Bell,
  LogOut,
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
import { Badge } from "@/components/ui/badge";

interface AppSidebarProps {
  user: {
    name: string;
    email: string;
    role: string;
    employeeId: string;
  };
  unreadCount?: number;
}

const mainNav = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["all"] },
  { title: "Attendance", href: "/attendance", icon: Clock, roles: ["all"] },
  { title: "Leaves", href: "/leaves", icon: Calendar, roles: ["all"] },
];

const adminNav = [
  { title: "Employees", href: "/employees", icon: Users, roles: ["SUPER_ADMIN", "HR_ADMIN"] },
  { title: "Departments", href: "/departments", icon: Building2, roles: ["SUPER_ADMIN", "HR_ADMIN"] },
];

const financeNav = [
  { title: "Payroll", href: "/payroll", icon: Wallet, roles: ["all"] },
  { title: "Incentives", href: "/incentives", icon: Gift, roles: ["all"] },
  { title: "Fines", href: "/fines", icon: AlertTriangle, roles: ["all"] },
  { title: "Warnings", href: "/warnings", icon: ShieldAlert, roles: ["all"] },
];

const otherNav = [
  { title: "Announcements", href: "/announcements", icon: Megaphone, roles: ["all"] },
  { title: "Reports", href: "/reports", icon: BarChart3, roles: ["SUPER_ADMIN", "HR_ADMIN"] },
  { title: "Settings", href: "/settings", icon: Settings, roles: ["SUPER_ADMIN"] },
];

function hasAccess(roles: string[], userRole: string) {
  return roles.includes("all") || roles.includes(userRole);
}

export function AppSidebar({ user, unreadCount = 0 }: AppSidebarProps) {
  const pathname = usePathname();

  const renderNavItems = (items: typeof mainNav) =>
    items
      .filter((item) => hasAccess(item.roles, user.role))
      .map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton render={<Link href={item.href} />} isActive={pathname === item.href}>
              <item.icon className="size-4" />
              <span>{item.title}</span>
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

        {adminNav.some((item) => hasAccess(item.roles, user.role)) && (
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(adminNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Finance & Discipline</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderNavItems(financeNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Other</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderNavItems(otherNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/notifications" />} isActive={pathname === "/notifications"}>
                <Bell className="size-4" />
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0">
                    {unreadCount}
                  </Badge>
                )}
            </SidebarMenuButton>
          </SidebarMenuItem>

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
                    Profile
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
