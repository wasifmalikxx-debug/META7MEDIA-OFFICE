"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
import { CalendarPlus } from "lucide-react";
import { AnimatedNumber } from "@/components/common/animated-number";

interface EmployeeDashboardProps {
  employeeName: string;
  employeeId: string;
  employeeStatus: string;
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
  workStartTime: string;
  breakStartTime: string;
  breakEndTime: string;
  workEndTime: string;
  isDayOff?: boolean;
  dayOffLabel?: string | null;
  hasSubmittedReport?: boolean;
  pendingLeaves?: number;
}

export function EmployeeDashboard({
  employeeName,
  employeeId,
  employeeStatus,
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
  workStartTime,
  breakStartTime,
  breakEndTime,
  workEndTime,
  isDayOff,
  dayOffLabel,
  hasSubmittedReport: initialHasReport,
  pendingLeaves = 1,
}: EmployeeDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState(todayAttendance);
  const [showSalary, setShowSalary] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ type: "HALF", date: "", reason: "" });
  const [leaves, setLeaves] = useState(initialLeaveRequests);
  const [editLeaveId, setEditLeaveId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [hasReport, setHasReport] = useState(!!initialHasReport);
  const [reportForm, setReportForm] = useState({
    listingsCount: 0, storeName: "", listingLinks: "",
    postsCount: 0, pageNames: "", notes: "",
  });
  const isEtsy = employeeId.startsWith("EM");
  const isFB = employeeId.startsWith("SMM");

  const router = useRouter();

  // Auto-refresh dashboard data every 2 minutes (reduced from 30s for performance)
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      router.refresh();
    }, 120_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          leaveType: "HALF_DAY",
          startDate: leaveForm.date,
          endDate: leaveForm.date,
          reason: leaveForm.reason || "Half day leave",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(editLeaveId ? "Leave updated!" : "Half day leave applied!");
      setLeaveOpen(false);
      setEditLeaveId(null);
      setLeaveForm({ type: "HALF", date: "", reason: "" });
      // Refresh leaves and attendance in parallel
      const [leavesRes, attRes] = await Promise.all([
        fetch("/api/leaves"),
        fetch("/api/attendance/today"),
      ]);
      if (leavesRes.ok) setLeaves(await leavesRes.json());
      if (attRes.ok) {
        const attData = await attRes.json();
        setAttendance(attData);
      }
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
      // Refresh attendance in case it was auto-checkout
      const attRes = await fetch("/api/attendance/today");
      if (attRes.ok) setAttendance(await attRes.json());
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

  // Check-in window: 30 minutes before office start time
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [wsH, wsM] = (workStartTime || "11:00").split(":").map(Number);
  const workStartMin = wsH * 60 + wsM;
  const checkInWindowStart = workStartMin - 30; // 30 min before office start
  const canCheckIn = currentMinutes >= checkInWindowStart;
  const checkInOpensAt = `${String(Math.floor(checkInWindowStart / 60)).padStart(2, "0")}:${String(checkInWindowStart % 60).padStart(2, "0")}`;

  // Break window check
  const [bsH, bsM] = (breakStartTime || "15:00").split(":").map(Number);
  const [beH, beM] = (breakEndTime || "16:00").split(":").map(Number);
  const breakStartMin = bsH * 60 + bsM;
  const breakEndMin = beH * 60 + beM;
  const isInBreakWindow = currentMinutes >= breakStartMin && currentMinutes <= breakEndMin;
  const breakWindowLabel = `${breakStartTime} - ${breakEndTime}`;

  // Work end time check (strict checkout rule)
  const [weH, weM] = (workEndTime || "19:00").split(":").map(Number);
  const workEndMin = weH * 60 + weM;
  const canCheckoutByTime = currentMinutes >= workEndMin - 30; // Allow checkout 30 min before office end
  // Check if employee has an approved half-day leave for today
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const hasHalfDayToday = leaves.some((l: any) => {
    const d = format(new Date(l.startDate), "yyyy-MM-dd");
    return d === todayStr && l.leaveType === "HALF_DAY" && l.status !== "REJECTED";
  });
  // Half day threshold = 4 hours = 240 minutes
  const halfDayThresholdMin = 240;
  // Calculate today's worked minutes for early checkout check
  let todayWorkedMin = 0;
  if (attendance?.checkIn) {
    const cIn = new Date(attendance.checkIn).getTime();
    let worked = (attendance?.checkOut ? new Date(attendance.checkOut).getTime() : Date.now()) - cIn;
    if (attendance?.breakStart) {
      const bEnd = attendance.breakEnd ? new Date(attendance.breakEnd).getTime() : Date.now();
      worked -= (bEnd - new Date(attendance.breakStart).getTime());
    }
    todayWorkedMin = Math.max(0, Math.floor(worked / 60000));
  }
  const canCheckoutHalfDay = hasHalfDayToday && todayWorkedMin >= halfDayThresholdMin;
  const canCheckout = canCheckoutByTime || canCheckoutHalfDay;

  // Format work end time for display
  const workEndFormatted = `${weH > 12 ? weH - 12 : weH}:${String(weM).padStart(2, "0")} ${weH >= 12 ? "PM" : "AM"}`;

  // Paid leave budget: 1.0 day per month. Half day = 0.5, absent = uses remaining budget
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const thisMonthLeaves = leaves.filter((l: any) => {
    const d = new Date(l.startDate);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear && l.status !== "REJECTED";
  });
  const halfDayLeaves = thisMonthLeaves.filter((l: any) => l.leaveType === "HALF_DAY");
  const halfDaysUsed = halfDayLeaves.length;

  // Check if leave can be applied (todayStr already defined above)
  // Calculate today's worked minutes for threshold check
  let todayWorkedMinutes = 0;
  if (attendance?.checkIn) {
    const checkInMs = new Date(attendance.checkIn).getTime();
    let workedMs = (attendance?.checkOut ? new Date(attendance.checkOut).getTime() : Date.now()) - checkInMs;
    if (attendance.breakStart) {
      const breakEndMs = attendance.breakEnd ? new Date(attendance.breakEnd).getTime() : Date.now();
      workedMs -= (breakEndMs - new Date(attendance.breakStart).getTime());
    }
    todayWorkedMinutes = Math.max(0, Math.floor(workedMs / 60000));
  }
  const thresholdMinutes = 240; // 4 hours
  const thresholdMet = todayWorkedMinutes >= thresholdMinutes;

  function getLeaveBlockMessage(): string | null {
    if (!leaveForm.date) return null;
    const selectedDate = leaveForm.date;

    // Check duplicate
    const existingLeave = leaves.find((l: any) => {
      const ld = l.startDate.split("T")[0];
      return ld === selectedDate && l.status !== "REJECTED" && l.id !== editLeaveId;
    });
    if (existingLeave) {
      return "You already have a leave on this date.";
    }

    // For today: must complete threshold first
    if (selectedDate === todayStr) {
      if (!attendance?.checkIn) {
        return "You must check in and complete 4 hours before applying half day for today.";
      }
      if (attendance?.checkOut) {
        return "You already checked out today.";
      }
      if (!thresholdMet) {
        const remaining = thresholdMinutes - todayWorkedMinutes;
        const h = Math.floor(remaining / 60);
        const m = remaining % 60;
        return `Complete ${h}h ${m}m more work before applying half day (4h minimum required).`;
      }
    }

    return null;
  }
  const leaveBlockMsg = getLeaveBlockMessage();
  const breakDone = !!attendance?.breakEnd;

  async function handleSubmitReport() {
    setLoading(true);
    try {
      const res = await fetch("/api/daily-work-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Daily report submitted!");
      setHasReport(true);
      setReportOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

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
  const totalIncentivesAmount = recentIncentives.reduce((s: number, i: any) => s + i.amount, 0);

  // Live hours worked: server total + today's live hours
  let liveTotalMinutes = totalWorkedHours * 60;
  if (attendance?.checkIn && !attendance?.checkOut) {
    const checkInMs = new Date(attendance.checkIn).getTime();
    let todayWorkedMs = Date.now() - checkInMs;
    if (attendance.breakStart) {
      const breakEndMs = attendance.breakEnd ? new Date(attendance.breakEnd).getTime() : Date.now();
      todayWorkedMs -= (breakEndMs - new Date(attendance.breakStart).getTime());
    }
    liveTotalMinutes += Math.max(0, Math.floor(todayWorkedMs / 60000));
  } else if (attendance?.workedMinutes) {
    // Today already checked out but might not be in monthAttendances yet
    liveTotalMinutes += attendance.workedMinutes;
  }
  const liveWorkedHours = Math.floor(liveTotalMinutes / 60);
  const liveWorkedMins = liveTotalMinutes % 60;

  // Estimated Salary = Monthly Salary + Incentives - Fines
  const salaryTillNow = Math.round(monthlySalary + totalIncentivesAmount - totalFinesAmount);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          Welcome Back, {employeeName}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            employeeStatus === "PROBATION" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
            employeeStatus === "HIRED" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
            "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          }`}>
            {employeeStatus}
          </span>
        </h1>
        <p className="text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
      </div>

      {/* Check-in/out card */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row items-center gap-4 pt-6">
          {isDayOff ? (
            <div className="flex-1 space-y-1">
              <p className="text-sm text-muted-foreground">Today&apos;s Status</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  Day Off
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {dayOffLabel || "Enjoy your day off!"}
                </span>
              </div>
            </div>
          ) : (
          <div className="flex-1 flex flex-col sm:flex-row items-center gap-4">
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
              <>
                {currentMinutes < breakStartMin && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Coffee className="size-3" />
                    Break starts at {breakStartTime}
                  </span>
                )}
                {isInBreakWindow && (
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
                {currentMinutes > breakEndMin && (
                  <Badge variant="destructive" className="text-xs py-1.5 px-3 gap-1.5">
                    <Coffee className="size-3" />
                    Break missed ({breakWindowLabel})
                  </Badge>
                )}
              </>
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
            {breakDone && (
              <Badge variant="secondary" className="text-xs py-1.5 px-3 gap-1.5">
                <Coffee className="size-3" />
                Break ended at {format(new Date(attendance.breakEnd), "h:mm a")}
              </Badge>
            )}
            {hasCheckedIn && !hasCheckedOut && !hasReport && (
              <Dialog open={reportOpen} onOpenChange={setReportOpen}>
                <DialogTrigger render={<Button variant="default" size="sm" className="gap-2" />}>
                  <CalendarPlus className="size-4" />
                  Submit Report
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Daily Work Report</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    {isEtsy && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">How many listings did you do?</Label>
                          <Input type="number" min="0" value={reportForm.listingsCount} onChange={(e) => setReportForm({ ...reportForm, listingsCount: parseInt(e.target.value) || 0 })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Which store did you work on today?</Label>
                          <Input value={reportForm.storeName} onChange={(e) => setReportForm({ ...reportForm, storeName: e.target.value })} placeholder="Store name..." />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Listing links (one per line)</Label>
                          <Textarea value={reportForm.listingLinks} onChange={(e) => setReportForm({ ...reportForm, listingLinks: e.target.value })} placeholder="Paste listing links..." rows={4} />
                        </div>
                      </div>
                    )}
                    {isFB && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">How many posts did you do?</Label>
                          <Input type="number" min="0" value={reportForm.postsCount} onChange={(e) => setReportForm({ ...reportForm, postsCount: parseInt(e.target.value) || 0 })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Page names you worked on</Label>
                          <Textarea value={reportForm.pageNames} onChange={(e) => setReportForm({ ...reportForm, pageNames: e.target.value })} placeholder="Enter page names..." rows={3} />
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes (optional)</Label>
                      <Input value={reportForm.notes} onChange={(e) => setReportForm({ ...reportForm, notes: e.target.value })} placeholder="Any additional notes..." />
                    </div>
                    <Button onClick={handleSubmitReport} disabled={loading} className="w-full">
                      {loading ? "Submitting..." : "Submit Report"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
            {hasCheckedIn && !hasCheckedOut && hasReport && (
              <Badge variant="secondary" className="text-xs py-1.5 px-3 gap-1.5 bg-green-100 text-green-700">
                <CheckCircle className="size-3" />
                Report Submitted
              </Badge>
            )}
            {hasCheckedIn && !hasCheckedOut && !onBreak && (
              <>
                {canCheckout ? (
                  <Button
                    onClick={handleCheckOut}
                    disabled={loading}
                    variant="outline"
                    className="gap-2"
                  >
                    <XCircle className="size-4" />
                    {loading ? "..." : "Check Out"}
                  </Button>
                ) : todayWorkedMin < halfDayThresholdMin ? (
                  <span className="text-xs text-muted-foreground">
                    Checkout available at {workEndFormatted}
                  </span>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      You&apos;ve worked {Math.floor(todayWorkedMin / 60)}h {todayWorkedMin % 60}m — half day will be recorded
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Full checkout at {workEndFormatted} • Or apply half day leave
                    </span>
                  </div>
                )}
              </>
            )}
            {hasCheckedOut && (
              <Badge variant="secondary" className="text-sm py-1.5 px-3">
                Day Complete
              </Badge>
            )}
          </div>
          </div>)}
        </CardContent>

      </Card>

      {/* Monthly stats */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-bold">
            {new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}
          </h2>
          <p className="text-[10px] text-muted-foreground/60">Resets on 1st of every month</p>
        </div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Present Days"
            value={monthPresent}
            icon={CheckCircle}
          />
          <StatCard
            title="Absent Days"
            value={monthAbsent}
            icon={XCircle}
          />
          <StatCard
            title="Late Arrivals"
            value={monthLate}
            icon={Clock}
          />
          <StatCard
            title="Hours Worked"
            value={`${liveWorkedHours}h ${liveWorkedMins}m`}
            icon={Clock}
          />
        </div>
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
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground font-medium">Estimated Salary</p>
                  <p className="text-2xl font-bold tracking-tight">
                    {showSalary ? (
                      <AnimatedNumber value={salaryTillNow} prefix="PKR " />
                    ) : (
                      "PKR ****"
                    )}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2.5">
                  <Wallet className="size-5 text-muted-foreground" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {attendance?.checkIn && !attendance?.checkOut ? (
                  <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                    Live — updating every minute
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                    <span className="inline-block size-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live — updating every minute
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
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
                // 15-minute edit window from creation time
                const canEdit = minutesSinceCreated <= 15;
                const cancelTimeLeft = isToday && canEdit ? Math.max(0, 15 - minutesSinceCreated) : null;
                return (
                  <div key={leave.id} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 border-b last:border-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {leave.leaveType === "HALF_DAY" ? "Half Day" : "Full Day"}
                        </span>
                        {canEdit ? (
                          <Badge variant="secondary" className="text-xs">
                            Pending
                          </Badge>
                        ) : (
                          <Badge variant="default" className="text-xs bg-green-600">
                            Approved
                          </Badge>
                        )}
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

      {/* Leave Policy + Apply Half Day */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Leave Policy — This Month</p>
            {pendingLeaves <= 0 && (
              <span className="text-xs text-red-500 font-medium">Budget exhausted</span>
            )}
            {pendingLeaves > 0 && (
            <Dialog open={leaveOpen} onOpenChange={(open) => {
              setLeaveOpen(open);
              if (!open) { setEditLeaveId(null); setLeaveForm({ type: "HALF", date: "", reason: "" }); }
            }}>
              <DialogTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
                <CalendarPlus className="size-4" /> Apply Half Day
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Apply Half Day Leave</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Half day uses <strong>0.5</strong> from your paid leave budget. You must complete the minimum threshold before checking out.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={leaveForm.date}
                      min={new Date().toISOString().split("T")[0]}
                      onChange={(e) => setLeaveForm({ ...leaveForm, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Reason <span className="text-red-500">*</span></Label>
                    <Input
                      value={leaveForm.reason}
                      onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                      placeholder="e.g. Doctor appointment, Family emergency"
                    />
                    {leaveForm.date && !leaveForm.reason.trim() && (
                      <p className="text-xs text-red-500">Please provide a valid reason for half day leave.</p>
                    )}
                  </div>
                  {leaveBlockMsg && (
                    <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2.5 text-sm text-red-600 dark:text-red-400">
                      {leaveBlockMsg}
                    </div>
                  )}
                  <Button onClick={handleApplyLeave} disabled={loading || !!leaveBlockMsg || !leaveForm.reason.trim()} className="w-full">
                    {loading ? "Applying..." : "Submit Half Day"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            )}
          </div>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Pending Leaves (Rollover)</span>
                <span>{pendingLeaves.toFixed(1)} day{pendingLeaves !== 1 ? "s" : ""} available</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pendingLeaves >= 2 ? "bg-green-500" : pendingLeaves > 0 ? "bg-yellow-500" : "bg-red-500"}`}
                  style={{ width: `${Math.min(100, (pendingLeaves / 3) * 100)}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Half Days</span>
                <span className="font-medium">{halfDaysUsed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Absences</span>
                <span className="font-medium">{monthAbsent}</span>
              </div>
            </div>
            {pendingLeaves > 1 && (
              <p className="text-xs text-green-600 dark:text-green-400">
                You have {pendingLeaves.toFixed(1)} pending leaves (unused leaves roll over monthly).
              </p>
            )}
            {pendingLeaves > 0 && pendingLeaves <= 1 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {pendingLeaves.toFixed(1)} leave remaining. Use wisely!
              </p>
            )}
            {pendingLeaves === 0 && (
              <p className="text-xs text-red-500">
                No pending leaves. Further absences/half days will be deducted from salary.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
