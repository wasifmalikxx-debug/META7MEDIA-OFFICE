"use client";

import {
  Users,
  UserCheck,
  UserX,
  Clock,
  CalendarOff,
  Wallet,
  AlertTriangle,
  TrendingUp,
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
  onLeaveToday: number;
  pendingLeaves: number;
  totalPayable: number;
  totalFines: number;
  totalIncentives: number;
  announcements: any[];
  recentAttendances: any[];
}

export function AdminDashboard({
  totalEmployees,
  presentToday,
  lateToday,
  absentToday,
  onLeaveToday,
  pendingLeaves,
  totalPayable,
  totalFines,
  totalIncentives,
  announcements,
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

      {/* Top Stats Row */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
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
      </div>

      {/* Finance Stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="On Leave"
          value={onLeaveToday}
          icon={CalendarOff}
        />
        <StatCard
          title="Pending Leaves"
          value={pendingLeaves}
          icon={CalendarOff}
          description="Awaiting approval"
          variant={pendingLeaves > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Total Payable"
          value={`PKR ${totalPayable.toLocaleString()}`}
          icon={Wallet}
          description="This month"
        />
        <StatCard
          title="Fines / Incentives"
          value={`${totalFines.toLocaleString()} / ${totalIncentives.toLocaleString()}`}
          icon={TrendingUp}
          description="This month"
        />
      </div>

      {/* Bottom Section */}
      <div className="grid gap-4 lg:grid-cols-2">
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
                {recentAttendances.slice(0, 10).map((att: any) => (
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

        {/* Announcements */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Announcements</CardTitle>
              <Badge variant="outline" className="text-xs font-normal">
                {announcements.length} active
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="size-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No announcements yet.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {announcements.map((ann: any) => (
                  <div key={ann.id} className="py-2.5 px-2 rounded-md hover:bg-muted/50 transition-colors border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ann.title}</span>
                      {ann.priority >= 2 && (
                        <Badge variant="destructive" className="text-xs">
                          Urgent
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {ann.content}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(ann.createdAt), "MMM d, yyyy")} — {ann.author.firstName}
                    </span>
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
