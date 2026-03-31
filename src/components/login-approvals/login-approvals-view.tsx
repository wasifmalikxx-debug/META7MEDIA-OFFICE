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

  function renderDeviceCard(device: any) {
    const isPending = device.status === "PENDING";
    const isApproved = device.status === "APPROVED";
    return (
      <Card key={device.id} className={`border-0 shadow-sm overflow-hidden hover:shadow-md transition-shadow ${isPending ? "ring-1 ring-amber-300 dark:ring-amber-700" : ""}`}>
        <CardContent className="p-0">
          {/* Header */}
          <div className={`px-4 py-3 border-b ${isPending ? "bg-amber-50/50 dark:bg-amber-950/15" : isApproved ? "bg-emerald-50/30 dark:bg-emerald-950/10" : "bg-rose-50/30 dark:bg-rose-950/10"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  {device.user.firstName[0]}{device.user.lastName?.[0] || ""}
                </div>
                <div>
                  <span className="text-sm font-bold">{device.user.firstName} {device.user.lastName}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-muted-foreground font-mono">{device.user.employeeId}</span>
                    <Badge className={`text-[8px] h-4 border-0 ${isPending ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : isApproved ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"}`}>
                      {device.status}
                    </Badge>
                  </div>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="size-7 p-0 text-muted-foreground/40 hover:text-rose-600" onClick={() => handleDelete(device.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          {/* Details */}
          <div className="px-4 py-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                {getDeviceIcon(device.deviceName)}
                <span>Device</span>
              </div>
              <span className="font-medium">{device.deviceName || "Unknown"}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Fingerprint className="size-4" />
                <span>Fingerprint</span>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground truncate max-w-[120px]">{device.fingerprint?.slice(0, 16)}...</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-4" />
                <span>Requested</span>
              </div>
              <span className="font-medium">{format(new Date(device.createdAt), "MMM d, h:mm a")}</span>
            </div>
            {device.ipAddress && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IP Address</span>
                <span className="font-mono text-[10px]">{device.ipAddress}</span>
              </div>
            )}
          </div>
          {/* Actions */}
          {isPending && (
            <div className="px-4 py-3 border-t bg-muted/10 flex gap-2">
              <Button size="sm" className="flex-1 h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs" onClick={() => handleAction(device.id, "approve")}>
                <CheckCircle className="size-3.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-8 gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30 rounded-lg text-xs" onClick={() => handleAction(device.id, "reject")}>
                <XCircle className="size-3.5" /> Reject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
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

      {/* Pending Devices */}
      {pendingDevices.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Clock className="size-4 text-amber-500" />
            Awaiting Approval
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pendingDevices.map(renderDeviceCard)}
          </div>
        </div>
      )}

      {/* Approved Devices */}
      {approvedDevices.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-500" />
            Approved Devices
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {approvedDevices.map(renderDeviceCard)}
          </div>
        </div>
      )}

      {/* Rejected Devices */}
      {rejectedDevices.length > 0 && (
        <div className="space-y-3 opacity-60">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <ShieldX className="size-4 text-rose-500" />
            Rejected
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rejectedDevices.map(renderDeviceCard)}
          </div>
        </div>
      )}
    </div>
  );
}
