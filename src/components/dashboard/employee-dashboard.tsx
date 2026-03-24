"use client";

import { useState } from "react";
import {
  Clock,
  Calendar,
  Wallet,
  AlertTriangle,
  Gift,
  CheckCircle,
  XCircle,
  Coffee,
  Eye,
  EyeOff,
} from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarPlus } from "lucide-react";

interface EmployeeDashboardProps {
  employeeName: string;
  todayAttendance: any;
  leaveBalance: any;
  currentPayroll: any;
  recentFines: any[];
  recentIncentives: any[];
  announcements: any[];
  monthPresent: number;
  monthAbsent: number;
  monthLate: number;
  totalWorkedHours: number;
  monthlySalary: number;
  leaveRequests: any[];
}

export function EmployeeDashboard({
  employeeName,
  todayAttendance,
  leaveBalance,
  currentPayroll,
  recentFines,
  recentIncentives,
  announcements,
  monthPresent,
  monthAbsent,
  monthLate,
  totalWorkedHours,
  monthlySalary,
  leaveRequests: initialLeaveRequests,
}: EmployeeDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState(todayAttendance);
  const [showSalary, setShowSalary] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ type: "FULL", date: "", reason: "" });
  const [leaves, setLeaves] = useState(initialLeaveRequests);
  const [editLeaveId, setEditLeaveId] = useState<string | null>(null);

  async function handleApplyLeave() {
    if (!leaveForm.date) { toast.error("Please select a date"); return; }
    setLoading(true);
    try {
      const url = editLeaveId ? `/api/leaves/${editLeaveId}` : "/api/leaves";
      const method = editLeaveId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveType: leaveForm.type === "HALF" ? "HALF_DAY" : "CASUAL",
          startDate: leaveForm.date,
          endDate: leaveForm.date,
          reason: leaveForm.reason || (leaveForm.type === "HALF" ? "Half day leave" : "Full day leave"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(editLeaveId ? "Leave updated!" : "Leave applied!");
      setLeaveOpen(false);
      setEditLeaveId(null);
      setLeaveForm({ type: "FULL", date: "", reason: "" });
      // Refresh leaves
      const res2 = await fetch("/api/leaves");
      if (res2.ok) setLeaves(await res2.json());
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelLeave(id: string) {
    if (!confirm("Cancel this leave request?")) return;
    try {
      const res = await fetch(`/api/leaves/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setLeaves(leaves.filter((l: any) => l.id !== id));
      toast.success("Leave cancelled");
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  function openEditLeave(leave: any) {
    setEditLeaveId(leave.id);
    setLeaveForm({
      type: leave.leaveType === "HALF_DAY" ? "HALF" : "FULL",
      date: leave.startDate.split("T")[0],
      reason: leave.reason || "",
    });
    setLeaveOpen(true);
  }

  const hasCheckedIn = !!attendance?.checkIn;
  const hasCheckedOut = !!attendance?.checkOut;
  const onBreak = !!attendance?.breakStart && !attendance?.breakEnd;

  // Leave policy: 1 paid leave per month, 2 half days = 1 full leave
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const thisMonthLeaves = leaves.filter((l: any) => {
    const d = new Date(l.startDate);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear && l.status !== "REJECTED";
  });
  const fullDayLeaves = thisMonthLeaves.filter((l: any) => l.leaveType !== "HALF_DAY");
  const halfDayLeaves = thisMonthLeaves.filter((l: any) => l.leaveType === "HALF_DAY");
  const paidLeaveUsed = fullDayLeaves.length > 0 ? 1 : (halfDayLeaves.length >= 2 ? 1 : 0);
  const paidLeaveRemaining = 1 - paidLeaveUsed;
  const halfDaysUsed = halfDayLeaves.length;

  // Check if leave already exists for selected date
  function getLeaveBlockMessage(): string | null {
    if (!leaveForm.date) return null;
    const selectedDate = leaveForm.date;
    const existingLeave = leaves.find((l: any) => {
      const ld = l.startDate.split("T")[0];
      return ld === selectedDate && l.status !== "REJECTED" && l.id !== editLeaveId;
    });
    if (!existingLeave) return null;
    if (existingLeave.leaveType === "HALF_DAY" && leaveForm.type === "HALF") {
      return "You already took a half day leave on this date.";
    }
    if (existingLeave.leaveType !== "HALF_DAY") {
      return "You already have a full day leave on this date.";
    }
    if (leaveForm.type === "FULL" && existingLeave.leaveType === "HALF_DAY") {
      return "You already have a half day leave on this date. Cancel it first to apply full day.";
    }
    return "You already have a leave on this date.";
  }
  const leaveBlockMsg = getLeaveBlockMessage();
  const breakDone = !!attendance?.breakEnd;

  async function handleCheckIn() {
    setLoading(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {
          // GPS optional, continue without it
        }
      }

      const res = await fetch("/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check-in failed");
      setAttendance(data);
      toast.success("Checked in successfully!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckOut() {
    setLoading(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {
          // GPS optional
        }
      }

      const res = await fetch("/api/attendance/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check-out failed");
      setAttendance(data);
      toast.success("Checked out successfully!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBreakStart() {
    setLoading(true);
    try {
      const res = await fetch("/api/attendance/break-start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start break");
      setAttendance(data);
      toast.success("Break started!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBreakEnd() {
    setLoading(true);
    try {
      const res = await fetch("/api/attendance/break-end", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to end break");
      setAttendance(data);
      toast.success("Break ended!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const totalFinesAmount = recentFines.reduce((s, f) => s + f.amount, 0);
  const totalIncentivesAmount = recentIncentives.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome Back, ${employeeName}`}
        description={format(new Date(), "EEEE, MMMM d, yyyy")}
      />

      {/* Check-in/out card */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row items-center gap-4 pt-6">
          <div className="flex-1 space-y-1">
            <p className="text-sm text-muted-foreground">Today&apos;s Status</p>
            <div className="flex items-center gap-2">
              {attendance ? (
                <>
                  <Badge
                    variant={
                      attendance.status === "PRESENT"
                        ? "default"
                        : attendance.status === "LATE"
                        ? "secondary"
                        : "destructive"
                    }
                  >
                    {attendance.status}
                  </Badge>
                  {attendance.checkIn && (
                    <span className="text-sm text-muted-foreground">
                      In: {format(new Date(attendance.checkIn), "hh:mm a")}
                    </span>
                  )}
                  {attendance.checkOut && (
                    <span className="text-sm text-muted-foreground">
                      Out: {format(new Date(attendance.checkOut), "hh:mm a")}
                    </span>
                  )}
                  {attendance.workedMinutes && (
                    <span className="text-sm text-muted-foreground">
                      ({Math.floor(attendance.workedMinutes / 60)}h {attendance.workedMinutes % 60}m)
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Not checked in yet
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!hasCheckedIn && (
              <Button onClick={handleCheckIn} disabled={loading} className="gap-2">
                <CheckCircle className="size-4" />
                {loading ? "..." : "Check In"}
              </Button>
            )}
            {hasCheckedIn && !hasCheckedOut && !onBreak && !breakDone && (
              <Button
                onClick={handleBreakStart}
                disabled={loading}
                variant="secondary"
                className="gap-2"
              >
                <Coffee className="size-4" />
                {loading ? "..." : "Start Break"}
              </Button>
            )}
            {onBreak && (
              <Button
                onClick={handleBreakEnd}
                disabled={loading}
                variant="secondary"
                className="gap-2"
              >
                <Coffee className="size-4" />
                {loading ? "..." : "End Break"}
              </Button>
            )}
            {hasCheckedIn && !hasCheckedOut && (
              <Button
                onClick={handleCheckOut}
                disabled={loading || onBreak}
                variant="outline"
                className="gap-2"
              >
                <XCircle className="size-4" />
                {loading ? "..." : "Check Out"}
              </Button>
            )}
            {hasCheckedOut && (
              <Badge variant="secondary" className="text-sm py-1.5 px-3">
                Day Complete
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Apply Leave */}
      <div className="flex gap-2">
        <Dialog open={leaveOpen} onOpenChange={(open) => {
          setLeaveOpen(open);
          if (!open) { setEditLeaveId(null); setLeaveForm({ type: "FULL", date: "", reason: "" }); }
        }}>
          <DialogTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
            <CalendarPlus className="size-4" /> Apply Leave
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Apply for Leave</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Leave Policy Summary */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leave Policy — This Month</p>
                <div className="flex justify-between text-sm">
                  <span>Paid Leave</span>
                  <span className={paidLeaveRemaining > 0 ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                    {paidLeaveRemaining} of 1 remaining
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Half Days Used</span>
                  <span className="font-medium">{halfDaysUsed}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Full Days Used</span>
                  <span className="font-medium">{fullDayLeaves.length}</span>
                </div>
                {halfDaysUsed === 1 && fullDayLeaves.length === 0 && (
                  <p className="text-xs text-blue-600 mt-1">
                    💡 1 more half day = your paid leave is used
                  </p>
                )}
                {paidLeaveRemaining === 0 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Paid leave used. Further leaves will be unpaid (PKR deducted from salary).
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={leaveForm.type === "FULL" ? "default" : "outline"}
                  onClick={() => setLeaveForm({ ...leaveForm, type: "FULL" })}
                  className="flex-1"
                >
                  Full Day
                </Button>
                <Button
                  size="sm"
                  variant={leaveForm.type === "HALF" ? "default" : "outline"}
                  onClick={() => setLeaveForm({ ...leaveForm, type: "HALF" })}
                  className="flex-1"
                >
                  Half Day
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={leaveForm.date}
                  onChange={(e) => setLeaveForm({ ...leaveForm, date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reason (optional)</Label>
                <Input
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  placeholder="e.g. Personal work"
                />
              </div>
              {leaveBlockMsg && (
                <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2.5 text-sm text-red-600 dark:text-red-400">
                  {leaveBlockMsg}
                </div>
              )}
              <Button onClick={handleApplyLeave} disabled={loading || !!leaveBlockMsg} className="w-full">
                {loading ? "Applying..." : "Submit Leave"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Monthly stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Present Days"
          value={monthPresent}
          icon={CheckCircle}
          description="This month"
        />
        <StatCard
          title="Absent Days"
          value={monthAbsent}
          icon={XCircle}
          description="This month"
        />
        <StatCard
          title="Late Arrivals"
          value={monthLate}
          icon={Clock}
          description="This month"
        />
        <StatCard
          title="Hours Worked"
          value={`${totalWorkedHours}h`}
          icon={Clock}
          description="This month"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-medium text-muted-foreground">Salary & Finance</h3>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={() => setShowSalary(!showSalary)}
          >
            {showSalary ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {showSalary ? "Hide" : "Show"}
          </Button>
        </div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Monthly Salary"
            value={showSalary ? `PKR ${monthlySalary.toLocaleString()}` : "PKR ****"}
            icon={Wallet}
          />
          <StatCard
            title="Net Payable"
            value={showSalary ? `PKR ${(currentPayroll?.netSalary || 0).toLocaleString()}` : "PKR ****"}
            icon={Wallet}
            description="Estimated"
          />
          <StatCard
            title="Fines"
            value={showSalary ? `PKR ${totalFinesAmount.toLocaleString()}` : "PKR ****"}
            icon={AlertTriangle}
            description="This month"
          />
          <StatCard
            title="Incentives"
            value={showSalary ? `PKR ${totalIncentivesAmount.toLocaleString()}` : "PKR ****"}
            icon={Gift}
            description="This month"
          />
        </div>
      </div>

      {/* My Leave Requests */}
      {leaves.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="size-4" /> My Leave Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {leaves.map((leave: any) => {
                const leaveDate = new Date(leave.startDate);
                const today = new Date(); today.setHours(0,0,0,0);
                const isToday = leaveDate.getTime() === today.getTime();
                const isFuture = leaveDate > today;
                const createdAt = new Date(leave.createdAt);
                const minutesSinceCreated = Math.floor((Date.now() - createdAt.getTime()) / 60000);
                // Future leaves: always editable. Today's leaves: only within 15 min of applying
                const canEdit = leave.status === "PENDING" && (isFuture || (isToday && minutesSinceCreated <= 15));
                const cancelTimeLeft = isToday && canEdit ? Math.max(0, 15 - minutesSinceCreated) : null;
                return (
                  <div key={leave.id} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 border-b last:border-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {leave.leaveType === "HALF_DAY" ? "Half Day" : "Full Day"}
                        </span>
                        <Badge
                          variant={
                            leave.status === "APPROVED" ? "default"
                              : leave.status === "PENDING" ? "secondary"
                              : "destructive"
                          }
                          className="text-xs"
                        >
                          {leave.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(leaveDate, "EEE, MMM d, yyyy")}
                        {leave.reason && ` — ${leave.reason}`}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        {cancelTimeLeft !== null && (
                          <span className="text-xs text-muted-foreground mr-1">{cancelTimeLeft}m left</span>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openEditLeave(leave)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500"
                          onClick={() => handleCancelLeave(leave.id)}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Leave Policy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="size-4" /> Leave Policy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span>Paid Leave</span>
                <Badge variant="secondary" className="text-xs">1 / month</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                1 paid leave per month is auto-applied to your first absence. No application needed. 2 half days = 1 paid leave.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Announcements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Announcements</CardTitle>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No announcements.</p>
            ) : (
              <div className="space-y-3">
                {announcements.map((ann: any) => (
                  <div key={ann.id} className="border-b pb-2 last:border-0">
                    <span className="text-sm font-medium">{ann.title}</span>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {ann.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
