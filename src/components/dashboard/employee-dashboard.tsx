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
}: EmployeeDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState(todayAttendance);
  const [showSalary, setShowSalary] = useState(false);

  const hasCheckedIn = !!attendance?.checkIn;
  const hasCheckedOut = !!attendance?.checkOut;
  const onBreak = !!attendance?.breakStart && !attendance?.breakEnd;
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
