"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle, XCircle, Trash2, Monitor, Smartphone } from "lucide-react";

interface LoginApprovalsViewProps {
  devices: any[];
}

export function LoginApprovalsView({ devices: initialDevices }: LoginApprovalsViewProps) {
  const [devices, setDevices] = useState(initialDevices);
  const router = useRouter();

  const pendingCount = devices.filter((d) => d.status === "PENDING").length;
  const approvedCount = devices.filter((d) => d.status === "APPROVED").length;

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
      // Update local state
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
      return <Smartphone className="size-4 text-muted-foreground" />;
    }
    return <Monitor className="size-4 text-muted-foreground" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3 text-sm">
        <Badge variant={pendingCount > 0 ? "destructive" : "secondary"}>
          {pendingCount} Pending
        </Badge>
        <Badge variant="default" className="bg-green-600">
          {approvedCount} Approved
        </Badge>
      </div>

      {devices.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No device login requests yet. Employees will appear here when they first try to login.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.id} className={device.status === "PENDING" ? "bg-yellow-50/50 dark:bg-yellow-950/10" : ""}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">
                            {device.user.firstName} {device.user.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{device.user.employeeId}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getDeviceIcon(device.deviceName)}
                          <span className="text-sm">{device.deviceName || "Unknown"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {device.ipAddress || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(device.createdAt), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell>
                        {device.status === "PENDING" && (
                          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                            Pending
                          </Badge>
                        )}
                        {device.status === "APPROVED" && (
                          <Badge variant="default" className="bg-green-600">
                            Approved
                          </Badge>
                        )}
                        {device.status === "REJECTED" && (
                          <Badge variant="destructive">Rejected</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {device.status === "PENDING" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-green-600 hover:text-green-700"
                                onClick={() => handleAction(device.id, "approve")}
                              >
                                <CheckCircle className="size-4 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-500 hover:text-red-600"
                                onClick={() => handleAction(device.id, "reject")}
                              >
                                <XCircle className="size-4 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground"
                            onClick={() => handleDelete(device.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
