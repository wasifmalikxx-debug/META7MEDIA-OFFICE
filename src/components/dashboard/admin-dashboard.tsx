"use client";

import {
  Users,
  UserCheck,
  UserX,
  Clock,
  CalendarOff,
  Wallet,
  AlertTriangle,
  Gift,
} from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { PageHeader } from "@/components/common/page-header";
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
  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Dashboard"
        description={`Overview for ${format(new Date(), "EEEE, MMMM d, yyyy")}`}
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Employees" value={totalEmployees} icon={Users} />
        <StatCard
          title="Present Today"
          value={presentToday}
          icon={UserCheck}
          description={`${Math.round((presentToday / totalEmployees) * 100) || 0}% attendance`}
        />
        <StatCard title="Late Today" value={lateToday} icon={Clock} />
        <StatCard title="Absent Today" value={absentToday} icon={UserX} />
      </div>

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
          icon={AlertTriangle}
          description="This month"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            {recentAttendances.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No attendance records for today yet.
              </p>
            ) : (
              <div className="space-y-2">
                {recentAttendances.slice(0, 10).map((att: any) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>
                      {att.user.firstName} {att.user.lastName}
                      <span className="text-muted-foreground ml-1">
                        ({att.user.employeeId})
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      {att.checkIn && (
                        <span className="text-xs text-muted-foreground">
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
                        className="text-xs"
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Announcements</CardTitle>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No announcements yet.
              </p>
            ) : (
              <div className="space-y-3">
                {announcements.map((ann: any) => (
                  <div key={ann.id} className="border-b pb-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ann.title}</span>
                      {ann.priority >= 2 && (
                        <Badge variant="destructive" className="text-xs">
                          Urgent
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {ann.content}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(ann.createdAt), "MMM d")} by{" "}
                      {ann.author.firstName}
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
