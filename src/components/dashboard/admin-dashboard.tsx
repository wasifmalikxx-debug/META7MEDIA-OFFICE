"use client";

import {
  Users,
  UserCheck,
  UserX,
  Clock,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface AdminDashboardProps {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  totalPayable: number;
  totalFines: number;
  recentAttendances: any[];
}

export function AdminDashboard({
  totalEmployees,
  presentToday,
  lateToday,
  absentToday,
  totalPayable,
  totalFines,
  recentAttendances,
}: AdminDashboardProps) {
  const attendanceRate = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;

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

      {/* Today's Attendance */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Today&apos;s Attendance</CardTitle>
            <Badge variant="outline" className="text-xs font-normal">
              {recentAttendances.length} check-ins
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {recentAttendances.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="size-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No attendance records for today yet.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentAttendances.map((att: any) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {att.user.firstName[0]}{att.user.lastName?.[0] || ""}
                    </div>
                    <div>
                      <span className="text-sm font-medium">
                        {att.user.firstName} {att.user.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1.5">
                        {att.user.employeeId}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {att.checkIn && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {format(new Date(att.checkIn), "hh:mm a")}
                      </span>
                    )}
                    <Badge
                      variant={
                        att.status === "PRESENT"
                          ? "default"
                          : att.status === "LATE"
                          ? "secondary"
                          : "destructive"
                      }
                      className="text-xs min-w-[60px] justify-center"
                    >
                      {att.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
