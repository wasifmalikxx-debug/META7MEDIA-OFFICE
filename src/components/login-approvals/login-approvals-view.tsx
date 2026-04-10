"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle, XCircle, Trash2, Monitor, Smartphone, ShieldCheck,
  Clock, ShieldX, Fingerprint,
} from "lucide-react";

interface LoginApprovalsViewProps {
  devices: any[];
}

export function LoginApprovalsView({ devices: initialDevices }: LoginApprovalsViewProps) {
  const [devices, setDevices] = useState(initialDevices);
  const router = useRouter();

  const pendingDevices = devices.filter((d) => d.status === "PENDING");
  const approvedDevices = devices.filter((d) => d.status === "APPROVED");
  const rejectedDevices = devices.filter((d) => d.status === "REJECTED");

  async function handleAction(id: string, action: "approve" | "reject") {
    try {
      const res = await fetch("/api/device-approval", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`Device ${action}d`);
      router.refresh();
      setDevices(devices.map((d) =>
        d.id === id ? { ...d, status: action === "approve" ? "APPROVED" : "REJECTED" } : d
      ));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this device? The employee will need to re-register on next login.")) return;
    try {
      const res = await fetch(`/api/device-approval?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Device removed");
      setDevices(devices.filter((d) => d.id !== id));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  function getDeviceIcon(name: string) {
    if (name?.toLowerCase().includes("iphone") || name?.toLowerCase().includes("android")) {
      return <Smartphone className="size-4" />;
    }
    return <Monitor className="size-4" />;
  }

  function renderDeviceRow(device: any) {
    const isPending = device.status === "PENDING";
    const isApproved = device.status === "APPROVED";
    const statusColors = isPending
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : isApproved
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
    return (
      <div
        key={device.id}
        className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/20 transition-colors ${isPending ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}
      >
        {/* Avatar */}
        <div className="size-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
          {device.user.firstName[0]}
          {device.user.lastName?.[0] || ""}
        </div>

        {/* Employee */}
        <div className="min-w-0 w-[180px] shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold truncate">
              {device.user.firstName} {device.user.lastName}
            </span>
            <Badge className={`text-[8px] h-4 px-1 border-0 ${statusColors}`}>
              {device.status}
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            {device.user.employeeId}
          </span>
        </div>

        {/* Device */}
        <div className="min-w-0 w-[160px] shrink-0 hidden sm:block">
          <div className="flex items-center gap-1.5 text-xs">
            {getDeviceIcon(device.deviceName)}
            <span className="font-medium truncate">{device.deviceName || "Unknown"}</span>
          </div>
          <span className="text-[9px] text-muted-foreground font-mono truncate block">
            {device.fingerprint?.slice(0, 12)}...
          </span>
        </div>

        {/* Requested time */}
        <div className="min-w-0 w-[130px] shrink-0 hidden md:block">
          <div className="flex items-center gap-1.5 text-xs">
            <Clock className="size-3 text-muted-foreground" />
            <span>{format(new Date(device.createdAt), "MMM d, h:mm a")}</span>
          </div>
        </div>

        {/* IP */}
        <div className="min-w-0 flex-1 hidden lg:block">
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            {device.ipAddress || "—"}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {isPending && (
            <>
              <Button
                size="sm"
                className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[11px] px-2.5"
                onClick={() => handleAction(device.id, "approve")}
              >
                <CheckCircle className="size-3" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30 rounded-md text-[11px] px-2.5"
                onClick={() => handleAction(device.id, "reject")}
              >
                <XCircle className="size-3" />
                Reject
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0 text-muted-foreground/40 hover:text-rose-600"
            onClick={() => handleDelete(device.id)}
            title="Remove device"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  function renderSection(title: string, icon: React.ReactNode, items: any[], opacity = "") {
    if (items.length === 0) return null;
    return (
      <div className={`space-y-2 ${opacity}`}>
        <h3 className="text-sm font-bold flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-bold">
            {items.length}
          </Badge>
        </h3>
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            {items.map(renderDeviceRow)}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="size-3.5 text-amber-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Pending</p>
            </div>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{pendingDevices.length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Approved</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{approvedDevices.length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldX className="size-3.5 text-rose-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Rejected</p>
            </div>
            <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">{rejectedDevices.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Empty State */}
      {devices.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Fingerprint className="size-7 text-muted-foreground/40" />
            </div>
            <p className="text-muted-foreground font-semibold">No Device Requests</p>
            <p className="text-xs text-muted-foreground/60 mt-1">When employees login for the first time, their device requests will appear here</p>
          </CardContent>
        </Card>
      )}

      {renderSection(
        "Awaiting Approval",
        <Clock className="size-4 text-amber-500" />,
        pendingDevices
      )}
      {renderSection(
        "Approved Devices",
        <ShieldCheck className="size-4 text-emerald-500" />,
        approvedDevices
      )}
      {renderSection(
        "Rejected",
        <ShieldX className="size-4 text-rose-500" />,
        rejectedDevices,
        "opacity-70"
      )}
    </div>
  );
}
