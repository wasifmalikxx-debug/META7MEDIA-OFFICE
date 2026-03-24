"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AttendanceViewProps {
  attendances: any[];
  employees: any[];
  isAdmin: boolean;
  currentMonth: number;
  currentYear: number;
}

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PRESENT: "default",
  LATE: "secondary",
  HALF_DAY: "outline",
  ABSENT: "destructive",
  ON_LEAVE: "outline",
  HOLIDAY: "default",
  WEEKEND: "outline",
};

export function AttendanceView({
  attendances,
  employees,
  isAdmin,
  currentMonth,
  currentYear,
}: AttendanceViewProps) {
  const [filterEmployee, setFilterEmployee] = useState<string>("all");

  const filtered =
    filterEmployee === "all"
      ? attendances
      : attendances.filter((a) => a.userId === filterEmployee);

  // Summary counts
  const present = filtered.filter(
    (a) => a.status === "PRESENT" || a.status === "LATE"
  ).length;
  const late = filtered.filter((a) => a.status === "LATE").length;
  const absent = filtered.filter((a) => a.status === "ABSENT").length;
  const halfDay = filtered.filter((a) => a.status === "HALF_DAY").length;
  const onLeave = filtered.filter((a) => a.status === "ON_LEAVE").length;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex gap-4 items-center">
          <Select value={filterEmployee} onValueChange={(v) => setFilterEmployee(v ?? "all")}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName} ({emp.employeeId})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Present</p>
            <p className="text-xl font-bold">{present}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Late</p>
            <p className="text-xl font-bold text-yellow-600">{late}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Absent</p>
            <p className="text-xl font-bold text-red-600">{absent}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Half Day</p>
            <p className="text-xl font-bold">{halfDay}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">On Leave</p>
            <p className="text-xl font-bold">{onLeave}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Attendance Records — {format(new Date(currentYear, currentMonth - 1), "MMMM yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                {isAdmin && <TableHead>Employee</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Late (min)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground">
                    No attendance records found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((att) => (
                  <TableRow key={att.id}>
                    <TableCell className="text-sm">
                      {format(new Date(att.date), "EEE, MMM d")}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-sm">
                        {att.user.firstName} {att.user.lastName}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={statusColors[att.status] || "outline"} className="text-xs">
                        {att.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {att.checkIn
                        ? format(new Date(att.checkIn), "hh:mm a")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {att.checkOut
                        ? format(new Date(att.checkOut), "hh:mm a")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {att.workedMinutes
                        ? `${Math.floor(att.workedMinutes / 60)}h ${att.workedMinutes % 60}m`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {att.lateMinutes ? `${att.lateMinutes}m` : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
