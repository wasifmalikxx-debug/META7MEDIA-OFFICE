"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Check, X } from "lucide-react";

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
  CANCELLED: "secondary",
};

interface LeavesViewProps {
  leaves: any[];
  balance: any;
  isAdmin: boolean;
  userId: string;
}

export function LeavesView({ leaves, balance, isAdmin, userId }: LeavesViewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    leaveType: "CASUAL",
    halfDayPeriod: "" as string,
    startDate: "",
    endDate: "",
    reason: "",
  });

  const pendingLeaves = leaves.filter((l) => l.status === "PENDING");
  const otherLeaves = leaves.filter((l) => l.status !== "PENDING");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.leaveType === "HALF_DAY" && !form.halfDayPeriod) {
      toast.error("Please select First Half or Second Half");
      return;
    }
    setLoading(true);
    try {
      const payload = { ...form };
      if (form.leaveType !== "HALF_DAY") delete (payload as any).halfDayPeriod;
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Leave request submitted!");
      setOpen(false);
      setForm({ leaveType: "CASUAL", halfDayPeriod: "", startDate: "", endDate: "", reason: "" });
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(leaveId: string, action: "APPROVED" | "REJECTED") {
    try {
      const res = await fetch(`/api/leaves/${leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success(`Leave ${action.toLowerCase()}!`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Leave Balance */}
      {balance && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Casual Leave</p>
              <p className="text-lg font-bold">
                {balance.casualTotal - balance.casualUsed} / {balance.casualTotal}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Sick Leave</p>
              <p className="text-lg font-bold">
                {balance.sickTotal - balance.sickUsed} / {balance.sickTotal}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" />}>
              <Plus className="size-4 mr-1" /> Apply for Leave
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Apply for Leave</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Leave Type</Label>
                <Select
                  value={form.leaveType}
                  onValueChange={(v) => v && setForm({ ...form, leaveType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASUAL">Casual Leave</SelectItem>
                    <SelectItem value="SICK">Sick Leave</SelectItem>
                    <SelectItem value="UNPAID">Unpaid Leave</SelectItem>
                    <SelectItem value="EMERGENCY">Emergency Leave</SelectItem>
                    <SelectItem value="HALF_DAY">Half Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.leaveType === "HALF_DAY" && (
                <div className="space-y-2">
                  <Label>Half Day Period</Label>
                  <Select
                    value={form.halfDayPeriod}
                    onValueChange={(v) => v && setForm({ ...form, halfDayPeriod: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* If date is today, only allow second half (must check in first) */}
                      {form.startDate && form.startDate === new Date().toISOString().split("T")[0] ? (
                        <SelectItem value="SECOND_HALF">Second Half (leave after break)</SelectItem>
                      ) : (
                        <>
                          <SelectItem value="FIRST_HALF">First Half (arrive after break)</SelectItem>
                          <SelectItem value="SECOND_HALF">Second Half (leave after break)</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Enter reason for leave..."
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Submitting..." : "Submit Request"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue={isAdmin ? "pending" : "all"}>
        <TabsList>
          {isAdmin && (
            <TabsTrigger value="pending">
              Pending ({pendingLeaves.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="all">All Requests</TabsTrigger>
        </TabsList>

        {isAdmin && (
          <TabsContent value="pending">
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingLeaves.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No pending leave requests.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingLeaves.map((leave) => (
                        <TableRow key={leave.id}>
                          <TableCell className="text-sm">
                            {leave.user.firstName} {leave.user.lastName}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {leave.leaveType === "HALF_DAY" && leave.halfDayPeriod
                                ? leave.halfDayPeriod === "FIRST_HALF" ? "Half Day (1st)" : "Half Day (2nd)"
                                : leave.leaveType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(leave.startDate), "MMM d")} —{" "}
                            {format(new Date(leave.endDate), "MMM d")}
                          </TableCell>
                          <TableCell className="text-sm">{leave.totalDays}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {leave.reason}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleAction(leave.id, "APPROVED")}
                              >
                                <Check className="size-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleAction(leave.id, "REJECTED")}
                              >
                                <X className="size-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="all">
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && <TableHead>Employee</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(isAdmin ? otherLeaves : leaves).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={isAdmin ? 6 : 5}
                        className="text-center text-muted-foreground"
                      >
                        No leave requests found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (isAdmin ? otherLeaves : leaves).map((leave) => (
                      <TableRow key={leave.id}>
                        {isAdmin && (
                          <TableCell className="text-sm">
                            {leave.user.firstName} {leave.user.lastName}
                          </TableCell>
                        )}
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {leave.leaveType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(leave.startDate), "MMM d")} —{" "}
                          {format(new Date(leave.endDate), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-sm">{leave.totalDays}</TableCell>
                        <TableCell>
                          <Badge
                            variant={statusColors[leave.status] || "outline"}
                            className="text-xs"
                          >
                            {leave.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          {leave.reason}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
