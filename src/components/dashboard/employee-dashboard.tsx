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
import { formatPKTTime, formatPKTDisplay, formatPKTDate } from "@/lib/pkt";
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
  /** Prorated salary the employee can actually earn this month based on their
   *  joining date. Equal to monthlySalary for employees who joined before the
   *  month started. Less than monthlySalary for mid-month hires. */
  earnedMonthlySalary?: number;
  leaveRequests: any[];
  workStartTime: string;
  breakStartTime: string;
  breakEndTime: string;
  workEndTime: string;
  isDayOff?: boolean;
  dayOffLabel?: string | null;
  hasSubmittedReport?: boolean;
  pendingLeaves?: number;
  attendanceRate?: number;
  monthHalfDay?: number;
  totalWorkedMin?: number;
  weekAttendances?: { date: string; status: string }[];
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
  earnedMonthlySalary,
  leaveRequests: initialLeaveRequests,
  workStartTime,
  breakStartTime,
  breakEndTime,
  workEndTime,
  isDayOff,
  dayOffLabel,
  hasSubmittedReport: initialHasReport,
  pendingLeaves = 1,
  attendanceRate = 100,
  monthHalfDay = 0,
  totalWorkedMin = 0,
  weekAttendances = [],
}: EmployeeDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState(todayAttendance);
  const [showSalary, setShowSalary] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ type: "HALF", date: "", reason: "", halfDayPeriod: "" });
  const [leaves, setLeaves] = useState(initialLeaveRequests);
  const [editLeaveId, setEditLeaveId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Server time offset: computed as (server UTC ms - client Date.now()) so we can
  // use authoritative server time even when the user's PC clock is wrong.
  // Starts at 0 (trusts client) and gets corrected after the first fetch.
  const [serverTimeOffset, setServerTimeOffset] = useState(0);

  // Sync server time on mount and every 5 minutes so time stays accurate
  // even for clients with drifted/wrong PC clocks (e.g. remote employees on
  // anti-detect browsers, manually set system clocks, etc.)
  useEffect(() => {
    let cancelled = false;
    async function syncServerTime() {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/server-time", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const t1 = Date.now();
        // Account for round-trip latency — assume half of it was each direction
        const latency = Math.floor((t1 - t0) / 2);
        const serverNow = data.utcMs + latency;
        const offset = serverNow - Date.now();
        if (!cancelled) setServerTimeOffset(offset);
      } catch {}
    }
    syncServerTime();
    const interval = setInterval(syncServerTime, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const [reportOpen, setReportOpen] = useState(false);
  const [hasReport, setHasReport] = useState(!!initialHasReport);
  const [reportForm, setReportForm] = useState({
    listingsCount: 0, storeName: "", listingLinks: "",
    postsCount: 0, pageNames: "", notes: "",
  });
  const isEtsy = employeeId.startsWith("EM");
  const isFB = employeeId.startsWith("SMM");
  const isManager = employeeId === "EM-4"; // Izaan — managerial report

  const router = useRouter();

  // Re-render every 1 second so the live PKT clock and countdowns update in real time.
  // The 1s tick is CLIENT-ONLY (no DB queries, just React state), so it's cheap.
  // Full data refresh (which hits the DB) happens every 5 minutes and pauses when
  // the tab is hidden — this is the key to not exhausting the Supabase pool.
  useEffect(() => {
    const tickInterval = setInterval(() => setTick((t) => t + 1), 1000);

    function refreshData() {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }
    const refreshInterval = setInterval(refreshData, 5 * 60 * 1000);

    const onVis = () => { if (!document.hidden) refreshData(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(tickInterval);
      clearInterval(refreshInterval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApplyLeave() {
    if (!leaveForm.date) { toast.error("Please select a date"); return; }
    setLoading(true);
    try {
      const url = editLeaveId ? `/api/leaves/${editLeaveId}` : "/api/leaves";
      const method = editLeaveId ? "PATCH" : "POST";
      if (!leaveForm.halfDayPeriod) { toast.error("Please select First Half or Second Half"); setLoading(false); return; }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveType: "HALF_DAY",
          halfDayPeriod: leaveForm.halfDayPeriod,
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
      setLeaveForm({ type: "HALF", date: "", reason: "", halfDayPeriod: "" });
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
      halfDayPeriod: leave.halfDayPeriod || "",
    });
    setLeaveOpen(true);
  }

  const hasCheckedIn = !!attendance?.checkIn;
  const hasCheckedOut = !!attendance?.checkOut;
  const onBreak = !!attendance?.breakStart && !attendance?.breakEnd;
  const breakDone = !!attendance?.breakEnd;

  // Check-in window: 30 minutes before office start time (using PKT)
  // Use serverTimeOffset so the clock is correct even if the user's PC clock is wrong.
  // Authoritative UTC = Date.now() + serverTimeOffset, then add 5h for PKT.
  const trueUtcMs = Date.now() + serverTimeOffset;
  const pktNow = new Date(trueUtcMs + 5 * 60 * 60_000); // PKT time
  const currentMinutes = pktNow.getUTCHours() * 60 + pktNow.getUTCMinutes();
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

  // Live seconds for countdowns (refreshes every render, which is every 1 second)
  const pktSeconds = pktNow.getUTCSeconds();
  const currentTotalSeconds = currentMinutes * 60 + pktSeconds;

  // Format a duration in seconds into a compact countdown string
  function formatCountdown(totalSec: number): string {
    if (totalSec <= 0) return "now";
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // "What's Next" state machine — figures out the next action the employee
  // needs to take and how long until (or how long the current window stays open).
  // All calculations are in PKT-minutes-from-midnight and are timezone-agnostic.
  type NextAction = {
    label: string;          // e.g. "Start Break"
    countdown: string;      // e.g. "in 1h 5m" or "closes in 14m"
    state: "waiting" | "active" | "missed" | "done" | "dayoff";
    color: "blue" | "violet" | "emerald" | "amber" | "rose" | "slate";
    detail?: string;
  };

  const nextAction: NextAction = (() => {
    if (isDayOff) {
      return { label: "Day Off", countdown: "", state: "dayoff", color: "slate", detail: dayOffLabel || "Enjoy your day!" };
    }
    if (hasCheckedOut) {
      return { label: "Day Complete", countdown: "", state: "done", color: "emerald", detail: "See you tomorrow 👋" };
    }
    // Not checked in yet
    if (!hasCheckedIn) {
      if (currentMinutes < checkInWindowStart) {
        const secsUntil = (checkInWindowStart - currentMinutes) * 60 - pktSeconds;
        return { label: "Check In", countdown: `opens in ${formatCountdown(secsUntil)}`, state: "waiting", color: "slate", detail: `Check-in window opens at ${checkInOpensAt} PKT` };
      }
      if (currentMinutes <= workEndMin) {
        const secsUntil = (workEndMin - currentMinutes) * 60 - pktSeconds;
        return { label: "Check In", countdown: `window open · ${formatCountdown(secsUntil)} left`, state: "active", color: "blue", detail: "Click the Check In button to start your day" };
      }
      return { label: "Check-in closed", countdown: "", state: "missed", color: "rose", detail: "Office hours have ended" };
    }
    // On break right now
    if (onBreak) {
      const breakEndSecs = (breakEndMin + 5) * 60; // include grace minutes
      const secsLeft = Math.max(0, breakEndSecs - currentTotalSeconds);
      return { label: "On Break", countdown: secsLeft > 0 ? `end in ${formatCountdown(secsLeft)}` : "break ending now", state: "active", color: "amber", detail: "End break before grace period expires to avoid fine" };
    }
    // Break already done — waiting to checkout
    if (breakDone) {
      if (currentMinutes < workEndMin - 30) {
        const secsUntil = (workEndMin - 30 - currentMinutes) * 60 - pktSeconds;
        return { label: "Checkout", countdown: `opens in ${formatCountdown(secsUntil)}`, state: "waiting", color: "violet", detail: "Continue working until checkout window opens" };
      }
      return { label: "Checkout", countdown: "available now", state: "active", color: "emerald", detail: "Submit your report and check out" };
    }
    // Checked in, break not yet started
    if (currentMinutes < breakStartMin) {
      const secsUntil = (breakStartMin - currentMinutes) * 60 - pktSeconds;
      return { label: "Start Break", countdown: `opens in ${formatCountdown(secsUntil)}`, state: "waiting", color: "violet", detail: `Break window: ${breakStartTime} – ${breakEndTime} PKT` };
    }
    if (isInBreakWindow) {
      const secsUntil = (breakEndMin - currentMinutes) * 60 - pktSeconds;
      return { label: "Start Break", countdown: `closes in ${formatCountdown(secsUntil)}`, state: "active", color: "violet", detail: "Click Start Break now" };
    }
    // Break window missed, heading to checkout
    if (currentMinutes < workEndMin - 30) {
      const secsUntil = (workEndMin - 30 - currentMinutes) * 60 - pktSeconds;
      return { label: "Checkout", countdown: `opens in ${formatCountdown(secsUntil)}`, state: "missed", color: "amber", detail: "Break was missed — continue working until checkout" };
    }
    return { label: "Checkout", countdown: "available now", state: "active", color: "emerald", detail: "Submit your report and check out" };
  })();

  const nextActionColors: Record<string, { bg: string; border: string; text: string; ring: string }> = {
    blue: { bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-900", text: "text-blue-700 dark:text-blue-400", ring: "ring-blue-500" },
    violet: { bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-900", text: "text-violet-700 dark:text-violet-400", ring: "ring-violet-500" },
    emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-900", text: "text-emerald-700 dark:text-emerald-400", ring: "ring-emerald-500" },
    amber: { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-900", text: "text-amber-700 dark:text-amber-400", ring: "ring-amber-500" },
    rose: { bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-900", text: "text-rose-700 dark:text-rose-400", ring: "ring-rose-500" },
    slate: { bg: "bg-slate-50 dark:bg-slate-800/50", border: "border-slate-200 dark:border-slate-700", text: "text-slate-700 dark:text-slate-400", ring: "ring-slate-500" },
  };
  // Check if employee has an approved half-day leave for today
  const todayStr = `${pktNow.getUTCFullYear()}-${String(pktNow.getUTCMonth() + 1).padStart(2, "0")}-${String(pktNow.getUTCDate()).padStart(2, "0")}`;
  const hasHalfDayToday = leaves.some((l: any) => {
    const d = formatPKTDate(new Date(l.startDate));
    return d === todayStr && l.leaveType === "HALF_DAY" && l.status !== "REJECTED";
  });
  // Half day threshold = 4 hours = 240 minutes
  const halfDayThresholdMin = 240;
  // Calculate today's worked minutes from CHECK-IN time
  // Only subtract break time if break is COMPLETED (both start and end)
  // If break hasn't ended, don't subtract — checkout threshold is from check-in
  let todayWorkedMin = 0;
  if (attendance?.checkIn) {
    const cIn = new Date(attendance.checkIn).getTime();
    let worked = (attendance?.checkOut ? new Date(attendance.checkOut).getTime() : pktNow.getTime()) - cIn;
    if (attendance?.breakStart && attendance?.breakEnd) {
      worked -= (new Date(attendance.breakEnd).getTime() - new Date(attendance.breakStart).getTime());
    }
    todayWorkedMin = Math.max(0, Math.floor(worked / 60000));
  }
  const canCheckoutHalfDay = hasHalfDayToday && todayWorkedMin >= halfDayThresholdMin;
  const canCheckout = canCheckoutByTime || canCheckoutHalfDay;

  // Format work end time for display
  const workEndFormatted = `${weH > 12 ? weH - 12 : weH}:${String(weM).padStart(2, "0")} ${weH >= 12 ? "PM" : "AM"}`;

  // Paid leave budget: 1.0 day per month. Half day = 0.5, absent = uses remaining budget
  const currentMonth = pktNow.getUTCMonth();
  const currentYear = pktNow.getUTCFullYear();
  const thisMonthLeaves = leaves.filter((l: any) => {
    const d = new Date(l.startDate);
    return d.getUTCMonth() === currentMonth && d.getUTCFullYear() === currentYear && l.status !== "REJECTED";
  });
  const halfDayLeaves = thisMonthLeaves.filter((l: any) => l.leaveType === "HALF_DAY");
  const halfDaysUsed = halfDayLeaves.length;

  // Check if leave can be applied (todayStr already defined above)
  // Calculate today's worked minutes for threshold check
  let todayWorkedMinutes = 0;
  if (attendance?.checkIn) {
    const checkInMs = new Date(attendance.checkIn).getTime();
    let workedMs = (attendance?.checkOut ? new Date(attendance.checkOut).getTime() : pktNow.getTime()) - checkInMs;
    if (attendance.breakStart) {
      const breakEndMs = attendance.breakEnd ? new Date(attendance.breakEnd).getTime() : pktNow.getTime();
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

  // Live hours worked: server total from monthAttendances (includes today if checked out)
  // Only add live calculation if still checked in (not yet in workedMinutes)
  let liveTotalMinutes = totalWorkedHours * 60;
  if (attendance?.checkIn && !attendance?.checkOut) {
    // Still working — add live time for today (not yet in monthAttendances workedMinutes)
    const checkInMs = new Date(attendance.checkIn).getTime();
    let todayWorkedMs = pktNow.getTime() - checkInMs;
    if (attendance.breakStart) {
      const breakEndMs = attendance.breakEnd ? new Date(attendance.breakEnd).getTime() : pktNow.getTime();
      todayWorkedMs -= (breakEndMs - new Date(attendance.breakStart).getTime());
    }
    liveTotalMinutes += Math.max(0, Math.floor(todayWorkedMs / 60000));
  }
  // No else needed — if checked out, workedMinutes is already in monthAttendances total
  const liveWorkedHours = Math.floor(liveTotalMinutes / 60);
  const liveWorkedMins = liveTotalMinutes % 60;

  // Estimated Salary = Earned Salary (prorated for mid-month hires) + Incentives - Fines.
  // `earnedMonthlySalary` comes from the server with joining-date proration already
  // applied; falls back to `monthlySalary` for older callers without the new prop.
  const earnedSalary = typeof earnedMonthlySalary === "number" ? earnedMonthlySalary : monthlySalary;
  const salaryTillNow = Math.round(earnedSalary + totalIncentivesAmount - totalFinesAmount);

  // Live PKT clock values (re-calculated every second via the tick interval)
  const pktClock = pktNow;
  const pktHours = pktClock.getUTCHours();
  const pktMins = pktClock.getUTCMinutes();
  const pktSecs = pktClock.getUTCSeconds();
  const pktTimeStr = `${String(pktHours % 12 || 12).padStart(2, "0")}:${String(pktMins).padStart(2, "0")}:${String(pktSecs).padStart(2, "0")} ${pktHours >= 12 ? "PM" : "AM"}`;

  // Detect browser/device timezone mismatch with PKT (UTC+5)
  // If the user's PC is on a different timezone, show a warning banner so they don't
  // get confused by local vs office times (e.g. USA employee seeing 3:21 AM on their PC).
  let timezoneMismatch = false;
  let deviceOffsetLabel = "";
  if (typeof window !== "undefined") {
    // getTimezoneOffset returns minutes BEHIND UTC (e.g. EDT = 240)
    const offsetMin = -new Date().getTimezoneOffset(); // positive for ahead of UTC
    timezoneMismatch = offsetMin !== 300; // PKT = +300 min (UTC+5)
    const hours = Math.floor(Math.abs(offsetMin) / 60);
    const mins = Math.abs(offsetMin) % 60;
    deviceOffsetLabel = `UTC${offsetMin >= 0 ? "+" : "-"}${hours}${mins > 0 ? ":" + String(mins).padStart(2, "0") : ""}`;
  }

  return (
    <div className="space-y-6">
      {/* Header with live PKT clock */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            Welcome Back, {employeeName}
            <Badge className={`text-[10px] font-bold border-0 ${
              employeeStatus === "PROBATION" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" :
              "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            }`}>
              {employeeStatus}
            </Badge>
          </h1>
          <p className="text-muted-foreground mt-1">{formatPKTDisplay(pktClock, "EEEE, MMMM d, yyyy")}</p>
        </div>
        {/* Live PKT Clock — always shows Pakistan time regardless of device timezone */}
        <div className="rounded-xl border bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-950/40 dark:to-fuchsia-950/40 px-4 py-2.5 min-w-[170px]">
          <div className="flex items-center gap-1.5">
            <Clock className="size-3 text-violet-600 dark:text-violet-400" />
            <p className="text-[9px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400">
              Pakistan Time (PKT)
            </p>
          </div>
          <p className="text-2xl font-bold text-violet-900 dark:text-violet-100 tabular-nums leading-tight">{pktTimeStr}</p>
          <p className="text-[9px] text-violet-600/70 dark:text-violet-400/70">Office hours: {workStartTime} – {workEndTime} PKT</p>
        </div>
      </div>

      {/* Timezone mismatch warning */}
      {timezoneMismatch && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-300">
              Your device timezone is {deviceOffsetLabel} — the office runs on Pakistan Time (PKT, UTC+5)
            </p>
            <p className="text-[11px] text-amber-800 dark:text-amber-400 mt-0.5 leading-relaxed">
              Don't worry about doing time math. Use the <strong>"What's Next"</strong> card below — it shows you
              exactly when your next action (break / checkout) opens with a live countdown.
            </p>
          </div>
        </div>
      )}

      {/* What's Next — live countdown card (timezone-agnostic) */}
      {!isDayOff && !hasCheckedOut && (() => {
        const colors = nextActionColors[nextAction.color];
        return (
          <div className={`rounded-xl border ${colors.border} ${colors.bg} px-5 py-4 flex items-center gap-4`}>
            <div className={`size-12 rounded-full bg-white dark:bg-slate-900 border-2 ${colors.border} flex items-center justify-center shrink-0`}>
              {nextAction.state === "active" ? (
                <div className={`size-2.5 rounded-full bg-current animate-pulse ${colors.text}`} />
              ) : nextAction.state === "waiting" ? (
                <Clock className={`size-5 ${colors.text}`} />
              ) : nextAction.state === "missed" ? (
                <AlertTriangle className={`size-5 ${colors.text}`} />
              ) : (
                <CheckCircle className={`size-5 ${colors.text}`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                What's Next
              </p>
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className={`text-lg font-bold ${colors.text}`}>{nextAction.label}</p>
                {nextAction.countdown && (
                  <p className={`text-sm font-semibold ${colors.text} tabular-nums`}>
                    {nextAction.countdown}
                  </p>
                )}
              </div>
              {nextAction.detail && (
                <p className="text-[11px] text-muted-foreground mt-0.5">{nextAction.detail}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Today's Status Card */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {/* Status Header */}
          <div className={`px-5 py-4 ${isDayOff ? "bg-slate-50 dark:bg-slate-800/50" : hasCheckedOut ? "bg-gradient-to-r from-emerald-50 to-white dark:from-emerald-950/20 dark:to-slate-800" : hasCheckedIn ? "bg-gradient-to-r from-blue-50 to-white dark:from-blue-950/20 dark:to-slate-800" : "bg-gradient-to-r from-amber-50 to-white dark:from-amber-950/20 dark:to-slate-800"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`size-11 rounded-xl flex items-center justify-center ${isDayOff ? "bg-slate-200 dark:bg-slate-700" : hasCheckedOut ? "bg-emerald-100 dark:bg-emerald-900/30" : hasCheckedIn ? "bg-blue-100 dark:bg-blue-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
                  {isDayOff ? <Calendar className="size-5 text-slate-500" /> : hasCheckedOut ? <CheckCircle className="size-5 text-emerald-600" /> : hasCheckedIn ? <Clock className="size-5 text-blue-600" /> : <AlertTriangle className="size-5 text-amber-600" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold">
                      {isDayOff ? "Day Off" : hasCheckedOut ? "Day Complete" : hasCheckedIn ? "Currently Working" : "Not Checked In"}
                    </p>
                    {attendance && !isDayOff && (
                      <Badge className={`text-[8px] h-4 border-0 ${
                        attendance.status === "PRESENT" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                        attendance.status === "LATE" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                        "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                      }`}>{attendance.status}</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {isDayOff ? (dayOffLabel || "Enjoy your day off!") :
                     attendance?.checkIn ? (
                       <>In: {formatPKTTime(attendance.checkIn)}{attendance.checkOut ? ` — Out: ${formatPKTTime(attendance.checkOut)}` : ""}{attendance.workedMinutes > 0 ? ` — ${Math.floor(attendance.workedMinutes / 60)}h ${attendance.workedMinutes % 60}m worked` : ""}</>
                     ) : "Check in to start your day"}
                  </p>
                </div>
              </div>
              {/* Live indicator */}
              {hasCheckedIn && !hasCheckedOut && !isDayOff && (
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                  </span>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">Live</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          {!isDayOff && (
          <div className="px-5 py-3.5 border-t flex items-center gap-2 flex-wrap">
            {!hasCheckedIn && (
                <Button onClick={handleCheckIn} disabled={loading} className="gap-2 rounded-lg">
                  <CheckCircle className="size-4" />
                  {loading ? "..." : "Check In"}
                </Button>
            )}
            {hasCheckedIn && !hasCheckedOut && !onBreak && !breakDone && (
              <>
                {currentMinutes < breakStartMin && (
                  <Badge variant="outline" className="text-xs py-1.5 px-3 gap-1.5 tabular-nums">
                    <Coffee className="size-3" />
                    Break in {formatCountdown((breakStartMin - currentMinutes) * 60 - pktSeconds)}
                  </Badge>
                )}
                {isInBreakWindow && (
                  <Button onClick={handleBreakStart} disabled={loading} variant="secondary" className="gap-2 rounded-lg">
                    <Coffee className="size-4" />
                    {loading ? "..." : "Start Break"}
                  </Button>
                )}
                {currentMinutes > breakEndMin && (
                  <Badge className="text-xs py-1.5 px-3 gap-1.5 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-0">
                    <Coffee className="size-3" />
                    Break missed
                  </Badge>
                )}
              </>
            )}
            {onBreak && (
              <Button onClick={handleBreakEnd} disabled={loading} variant="secondary" className="gap-2 rounded-lg">
                <Coffee className="size-4" />
                {loading ? "..." : "End Break"}
              </Button>
            )}
            {breakDone && (
              <Badge variant="outline" className="text-xs py-1.5 px-3 gap-1.5">
                <Coffee className="size-3" />
                Break ended at {formatPKTTime(attendance.breakEnd)}
              </Badge>
            )}
            {hasCheckedIn && !hasCheckedOut && !hasReport && (
              <Dialog open={reportOpen} onOpenChange={setReportOpen}>
                <DialogTrigger render={<Button variant="default" size="sm" className="gap-2" />}>
                  <CalendarPlus className="size-4" />
                  Submit Report
                </DialogTrigger>
                <DialogContent className="sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-lg">End of Day Report</DialogTitle>
                  </DialogHeader>
                  <div className="rounded-lg border bg-muted/30 p-3 mb-1">
                    <p className="text-[11px] text-muted-foreground">
                      Complete your daily report before checking out. This is <strong>mandatory</strong> — auto-checkout without a report results in a fine.
                    </p>
                  </div>
                  <div className="space-y-4">
                    {/* Manager (Izaan / EM-4) uses a simple single-textarea template — same as FB */}
                    {isManager && (
                      <div className="rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 p-3">
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">Team Lead / Manager Report</p>
                      </div>
                    )}
                    {isEtsy && !isManager && (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold">Total Listings Completed</Label>
                          <Input type="number" min="0" value={reportForm.listingsCount} onChange={(e) => setReportForm({ ...reportForm, listingsCount: parseInt(e.target.value) || 0 })} placeholder="0" />
                          <p className="text-[10px] text-muted-foreground">Number of product listings you created or updated today</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold">Store Name</Label>
                          <Input value={reportForm.storeName} onChange={(e) => setReportForm({ ...reportForm, storeName: e.target.value })} placeholder="e.g. META7 Crafts, VintageFinds..." />
                          <p className="text-[10px] text-muted-foreground">Which Etsy store did you work on today?</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold">Listing URLs</Label>
                          <Textarea value={reportForm.listingLinks} onChange={(e) => setReportForm({ ...reportForm, listingLinks: e.target.value })} placeholder={"https://etsy.com/listing/...\nhttps://etsy.com/listing/...\nhttps://etsy.com/listing/..."} rows={5} className="font-mono text-[10px] break-all" />
                          <p className="text-[10px] text-muted-foreground">Paste each listing link on a new line</p>
                        </div>
                      </div>
                    )}
                    {isFB && (
                      <div className="space-y-4">
                        <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 p-3">
                          <p className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">Social Media Daily Report</p>
                        </div>
                      </div>
                    )}
                    {/* Main textarea: FB and Manager use it as the primary content, Etsy employees as optional notes */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        {isFB || isManager ? "What did you do today?" : "Additional Notes"}
                        {!isFB && !isManager && <span className="font-normal text-muted-foreground"> (optional)</span>}
                      </Label>
                      <Textarea
                        value={reportForm.notes}
                        onChange={(e) => setReportForm({ ...reportForm, notes: e.target.value })}
                        placeholder={
                          isFB
                            ? "Describe your work today in detail \u2014 tasks completed, content created, campaigns managed, client interactions, designs, scheduling..."
                            : isManager
                            ? "Describe your managerial tasks, reviews, escalations, stores supervised, team oversight, and decisions..."
                            : "Any challenges, achievements, or things to flag..."
                        }
                        rows={isFB || isManager ? 5 : 2}
                        className="text-xs"
                      />
                      {(isFB || isManager) && (
                        <p className="text-[10px] text-muted-foreground">
                          Provide a clear summary of all tasks and activities you completed today
                        </p>
                      )}
                    </div>
                    <Button onClick={handleSubmitReport} disabled={loading} className="w-full gap-2" size="lg">
                      <CheckCircle className="size-4" />
                      {loading ? "Submitting..." : "Submit Daily Report"}
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
                    Checkout available at {workEndFormatted} PKT
                  </span>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      You&apos;ve worked {Math.floor(todayWorkedMin / 60)}h {todayWorkedMin % 60}m — half day will be recorded
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Full checkout at {workEndFormatted} PKT • Or apply half day leave
                    </span>
                  </div>
                )}
              </>
            )}
            {hasCheckedOut && (
              <Badge className="text-xs py-1.5 px-3 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 gap-1.5">
                <CheckCircle className="size-3" />
                Completed
              </Badge>
            )}
          </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly stats */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">
            {new Date(trueUtcMs + 5 * 60 * 60_000).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
          </h2>
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Resets monthly</span>
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

        {/* Attendance Rate + This Week */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Attendance Rate */}
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Attendance Rate</span>
                <span className={`text-sm font-bold ${attendanceRate >= 90 ? "text-emerald-600" : attendanceRate >= 70 ? "text-amber-600" : "text-rose-600"}`}>
                  {attendanceRate}%
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${attendanceRate >= 90 ? "bg-emerald-500" : attendanceRate >= 70 ? "bg-amber-500" : "bg-rose-500"}`}
                  style={{ width: `${attendanceRate}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                <span>{monthPresent} present</span>
                <span>{monthAbsent} absent</span>
                <span>{monthHalfDay} half</span>
                <span>{monthLate} late</span>
              </div>
            </CardContent>
          </Card>

          {/* This Week */}
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">This Week</p>
              <div className="flex gap-1.5">
                {(() => {
                  const pktNowW = new Date(trueUtcMs + 5 * 60 * 60_000);
                  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                  const todayDow = pktNowW.getUTCDay();
                  // Get Monday of this week
                  const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow;
                  return days.map((name, i) => {
                    const dayDate = new Date(pktNowW);
                    dayDate.setUTCDate(pktNowW.getUTCDate() + mondayOffset + i);
                    const dateStr = dayDate.toISOString().split("T")[0];
                    const att = weekAttendances.find((a: any) => {
                      const aDate = typeof a.date === "string" ? a.date.split("T")[0] : new Date(a.date).toISOString().split("T")[0];
                      return aDate === dateStr;
                    });
                    const isFuture = dateStr > pktNowW.toISOString().split("T")[0];
                    const isToday = dateStr === pktNowW.toISOString().split("T")[0];
                    const statusColors: Record<string, string> = {
                      PRESENT: "bg-emerald-500 text-white",
                      LATE: "bg-amber-500 text-white",
                      HALF_DAY: "bg-blue-500 text-white",
                      ABSENT: "bg-rose-500 text-white",
                      ON_LEAVE: "bg-violet-500 text-white",
                    };
                    const statusLabels: Record<string, string> = {
                      PRESENT: "P", LATE: "L", HALF_DAY: "H", ABSENT: "A", ON_LEAVE: "LV",
                    };
                    return (
                      <div key={name} className={`flex-1 flex flex-col items-center gap-1 rounded-lg py-2 ${isToday ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900" : ""}`}>
                        <span className={`text-[10px] font-medium ${isToday ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>{name}</span>
                        {att ? (
                          <div className={`size-7 rounded-md flex items-center justify-center text-[9px] font-bold ${statusColors[att.status] || "bg-slate-200 text-slate-600"}`}>
                            {statusLabels[att.status] || "?"}
                          </div>
                        ) : isFuture ? (
                          <div className="size-7 rounded-md flex items-center justify-center text-[9px] text-muted-foreground/30">·</div>
                        ) : (
                          <div className="size-7 rounded-md flex items-center justify-center text-[9px] bg-muted/30 text-muted-foreground/50">-</div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Salary & Finance</h3>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8 rounded-lg"
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
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Estimated Salary</p>
                  <p className="text-2xl font-bold tracking-tight text-blue-700 dark:text-blue-400">
                    {showSalary ? (
                      <AnimatedNumber value={salaryTillNow} prefix="PKR " />
                    ) : (
                      "PKR ****"
                    )}
                  </p>
                </div>
                <div className="rounded-xl bg-blue-100 dark:bg-blue-900/30 p-2.5">
                  <Wallet className="size-5 text-blue-600 dark:text-blue-400" />
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

        {/* Salary Breakdown Bar */}
        {showSalary && monthlySalary > 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Salary Breakdown</p>
              <div className="h-4 rounded-full overflow-hidden flex bg-muted/30">
                {(() => {
                  // Scale the bar to the earned-salary pool (prorated for
                  // mid-month hires) so the ratio of Net:Fines is visually
                  // accurate, not squeezed by the full monthlySalary.
                  const barDenom = Math.max(1, earnedSalary + totalIncentivesAmount);
                  return (
                    <>
                      {salaryTillNow > 0 && (
                        <div className="bg-emerald-500 h-full transition-all" style={{ width: `${Math.min(100, (salaryTillNow / barDenom) * 100)}%` }} title={`Net: PKR ${salaryTillNow.toLocaleString()}`} />
                      )}
                      {totalFinesAmount > 0 && (
                        <div className="bg-rose-500 h-full transition-all" style={{ width: `${Math.min(100, (totalFinesAmount / barDenom) * 100)}%` }} title={`Fines: PKR ${totalFinesAmount.toLocaleString()}`} />
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between mt-2 text-[10px]">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" /> Net: PKR {salaryTillNow.toLocaleString()}</span>
                  {totalFinesAmount > 0 && <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-rose-500" /> Fines: PKR {totalFinesAmount.toLocaleString()}</span>}
                  {totalIncentivesAmount > 0 && <span className="flex items-center gap-1 text-emerald-600">+ Bonus: PKR {totalIncentivesAmount.toLocaleString()}</span>}
                </div>
                <span className="text-muted-foreground">Base: PKR {monthlySalary.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        )}
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
                const pktNowLeave = new Date(trueUtcMs + 5 * 60 * 60_000);
                const today = new Date(Date.UTC(pktNowLeave.getUTCFullYear(), pktNowLeave.getUTCMonth(), pktNowLeave.getUTCDate()));
                const isToday = leaveDate.getTime() === today.getTime();
                const isFuture = leaveDate > today;
                const createdAt = new Date(leave.createdAt);
                const minutesSinceCreated = Math.floor((trueUtcMs - createdAt.getTime()) / 60000);
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
                        {formatPKTDisplay(leaveDate, "EEE, MMM d, yyyy")}
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
              if (!open) { setEditLeaveId(null); setLeaveForm({ type: "HALF", date: "", reason: "", halfDayPeriod: "" }); }
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
                      min={new Date(trueUtcMs + 5 * 60 * 60_000).toISOString().split("T")[0]}
                      onChange={(e) => setLeaveForm({ ...leaveForm, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Period <span className="text-red-500">*</span></Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={leaveForm.halfDayPeriod === "FIRST_HALF" ? "default" : "outline"}
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setLeaveForm({ ...leaveForm, halfDayPeriod: "FIRST_HALF" })}
                      >
                        First Half (arrive after break)
                      </Button>
                      <Button
                        type="button"
                        variant={leaveForm.halfDayPeriod === "SECOND_HALF" ? "default" : "outline"}
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setLeaveForm({ ...leaveForm, halfDayPeriod: "SECOND_HALF" })}
                      >
                        Second Half (leave after break)
                      </Button>
                    </div>
                    {leaveForm.halfDayPeriod === "FIRST_HALF" && (
                      <p className="text-[10px] text-muted-foreground">You will arrive after break time — no late fine will apply</p>
                    )}
                    {leaveForm.halfDayPeriod === "SECOND_HALF" && (
                      <p className="text-[10px] text-muted-foreground">You will leave after break — submit report before leaving</p>
                    )}
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
                <span>Paid Leave Balance</span>
                <span>{pendingLeaves.toFixed(1)} day{pendingLeaves !== 1 ? "s" : ""} available</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pendingLeaves >= 1 ? "bg-emerald-500" : pendingLeaves > 0 ? "bg-amber-500" : "bg-rose-500"}`}
                  style={{ width: `${Math.min(100, pendingLeaves * 100)}%` }}
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
