"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  Wallet,
  AlertTriangle,
  Coffee,
  LogOut,
  CalendarOff,
  CalendarCheck2,
  CircleDot,
} from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface EmployeeStatus {
  id: string;
  firstName: string;
  lastName: string | null;
  employeeId: string;
  empStatus: string;
  liveStatus: string;
  checkIn: string | null;
  checkOut: string | null;
}

interface AdminDashboardProps {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  totalPayable: number;
  totalFines: number;
  recentAttendances: any[];
  employeeStatuses: EmployeeStatus[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  PRESENT: { label: "Present", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: UserCheck },
  LATE: { label: "Late", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: Clock },
  ON_BREAK: { label: "On Break", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Coffee },
  CHECKED_OUT: { label: "Checked Out", color: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400", icon: LogOut },
  ABSENT: { label: "Absent", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: UserX },
  ON_LEAVE: { label: "On Leave", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: CalendarOff },
  HALF_DAY: { label: "Half Day", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: CalendarCheck2 },
  HALF_DAY_LEAVE: { label: "Half Day Leave", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: CalendarOff },
  NOT_CHECKED_IN: { label: "Not Checked In", color: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400", icon: CircleDot },
};

export function AdminDashboard({
  totalEmployees,
  presentToday,
  lateToday,
  absentToday,
  totalPayable,
  totalFines,
  recentAttendances,
  employeeStatuses,
}: AdminDashboardProps) {
  const router = useRouter();
  const attendanceRate = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;

  // Live refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 30_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sort: ON_BREAK first, then PRESENT, LATE, NOT_CHECKED_IN, ABSENT, ON_LEAVE, CHECKED_OUT
  const statusOrder: Record<string, number> = {
    ON_BREAK: 0, PRESENT: 1, LATE: 2, HALF_DAY: 3,
    NOT_CHECKED_IN: 4, ABSENT: 5, HALF_DAY_LEAVE: 6, ON_LEAVE: 7, CHECKED_OUT: 8,
  };
  const sorted = [...employeeStatuses].sort(
    (a, b) => (statusOrder[a.liveStatus] ?? 9) - (statusOrder[b.liveStatus] ?? 9)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          {format(new Date(), "EEEE, MMMM d, yyyy")} — META7MEDIA Office Overview
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Employees"
          value={totalEmployees}
          icon={Users}
          description="Active workforce"
        />
        <StatCard
          title="Present Today"
          value={presentToday}
          icon={UserCheck}
          trend={attendanceRate >= 80 ? "up" : "down"}
          trendValue={`${attendanceRate}%`}
          description="attendance rate"
        />
        <StatCard
          title="Late Today"
          value={lateToday}
          icon={Clock}
          description={lateToday === 0 ? "All on time" : "Arrived after grace"}
        />
        <StatCard
          title="Absent Today"
          value={absentToday}
          icon={UserX}
          description={absentToday === 0 ? "Full attendance" : "Not checked in"}
        />
        <StatCard
          title="Fines"
          value={`PKR ${totalFines.toLocaleString()}`}
          icon={AlertTriangle}
          variant={totalFines > 0 ? "danger" : "default"}
          description="This month"
        />
        <StatCard
          title="Total Payable"
          value={`PKR ${totalPayable.toLocaleString()}`}
          icon={Wallet}
          description="This month"
        />
      </div>

      {/* Live Employee Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Live Employee Status</CardTitle>
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Auto-refreshing</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {sorted.map((emp) => {
              const config = STATUS_CONFIG[emp.liveStatus] || STATUS_CONFIG.NOT_CHECKED_IN;
              const Icon = config.icon;
              return (
                <div
                  key={emp.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {emp.firstName[0]}{emp.lastName?.[0] || ""}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {emp.firstName} {emp.lastName || ""}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {emp.employeeId}
                        </span>
                        {emp.empStatus === "PROBATION" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 font-medium">
                            PROBATION
                          </span>
                        )}
                      </div>
                      {emp.checkIn && (
                        <span className="text-[11px] text-muted-foreground">
                          In: {format(new Date(emp.checkIn), "hh:mm a")}
                          {emp.checkOut && ` — Out: ${format(new Date(emp.checkOut), "hh:mm a")}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full ${config.color}`}>
                    <Icon className="size-3.5" />
                    {config.label}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
