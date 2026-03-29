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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

interface FinesViewProps {
  fines: any[];
  employees: any[];
  isAdmin: boolean;
  currentMonth: number;
  currentYear: number;
  attendances?: any[];
  leaves?: any[];
}

export function FinesView({ fines, employees, isAdmin, currentMonth, currentYear, attendances = [], leaves = [] }: FinesViewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    userId: "",
    type: "LATE_ARRIVAL",
    amount: 0,
    reason: "",
    date: new Date().toISOString().split("T")[0],
  });

  const monthName = format(new Date(currentYear, currentMonth - 1), "MMMM yyyy");

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    router.push(`/fines?month=${m}&year=${y}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/fines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Fine added!");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFine(id: string) {
    if (!confirm("Remove this fine? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/fines/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        try { throw new Error(JSON.parse(text).error); } catch { throw new Error(text || "Failed"); }
      }
      toast.success("Fine removed");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const total = fines.reduce((s: number, f: any) => s + f.amount, 0);
  const coveredFines = fines.filter((f: any) => f.amount === 0);
  const actualFines = fines.filter((f: any) => f.amount > 0);
  const actualTotal = actualFines.reduce((s: number, f: any) => s + f.amount, 0);

  // Attendance stats
  const presentDays = attendances.filter((a: any) => a.status === "PRESENT" || a.status === "LATE").length;
  const absentDays = attendances.filter((a: any) => a.status === "ABSENT").length;
  const halfDays = attendances.filter((a: any) => a.status === "HALF_DAY").length;
  const lateDays = attendances.filter((a: any) => a.status === "LATE").length;
  const onLeaveDays = attendances.filter((a: any) => a.status === "ON_LEAVE").length;

  const typeLabels: Record<string, string> = {
    LATE_ARRIVAL: "Late",
    EARLY_DEPARTURE: "Early Leave",
    ABSENT_WITHOUT_LEAVE: "Absent",
    POLICY_VIOLATION: "Policy Violation",
    OTHER: "Other",
  };

  const typeColors: Record<string, string> = {
    LATE_ARRIVAL: "bg-amber-100 text-amber-700 hover:bg-amber-100",
    EARLY_DEPARTURE: "bg-orange-100 text-orange-700 hover:bg-orange-100",
    ABSENT_WITHOUT_LEAVE: "bg-red-100 text-red-700 hover:bg-red-100",
    POLICY_VIOLATION: "bg-purple-100 text-purple-700 hover:bg-purple-100",
    OTHER: "bg-gray-100 text-gray-700 hover:bg-gray-100",
  };

  // Group employees by department for dropdown
  const etsyEmployees = employees.filter((e: any) => e.department?.name === "Etsy");
  const fbEmployees = employees.filter((e: any) => e.department?.name === "Facebook");
  const otherEmployees = employees.filter((e: any) => !e.department?.name || (e.department.name !== "Etsy" && e.department.name !== "Facebook"));

  // Group fines + leaves by date into unified feed
  const grouped: Record<string, any[]> = {};
  fines.forEach((fine: any) => {
    const dateKey = format(new Date(fine.date || fine.createdAt), "yyyy-MM-dd");
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push({ ...fine, _type: "fine" });
  });
  leaves.forEach((leave: any) => {
    const dateKey = format(new Date(leave.startDate), "yyyy-MM-dd");
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push({ ...leave, _type: "leave" });
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => goMonth(-1)} className="size-8">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="text-lg font-bold min-w-[180px] text-center">{monthName}</h2>
          <Button variant="outline" size="icon" onClick={() => goMonth(1)} className="size-8">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" variant="destructive" />}>
              <Plus className="size-4 mr-1" /> Add Fine
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Add Fine</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select value={form.userId} onValueChange={(v) => v && setForm({ ...form, userId: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select employee..." /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {etsyEmployees.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">Etsy Team</div>
                          {etsyEmployees.map((emp: any) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.firstName} {emp.lastName} ({emp.employeeId})
                            </SelectItem>
                          ))}
                        </>
                      )}
                      {fbEmployees.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 mt-1">Facebook Team</div>
                          {fbEmployees.map((emp: any) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.firstName} {emp.lastName} ({emp.employeeId})
                            </SelectItem>
                          ))}
                        </>
                      )}
                      {otherEmployees.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 mt-1">Other</div>
                          {otherEmployees.map((emp: any) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.firstName} {emp.lastName} ({emp.employeeId})
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LATE_ARRIVAL">Late Arrival</SelectItem>
                        <SelectItem value="EARLY_DEPARTURE">Early Departure</SelectItem>
                        <SelectItem value="ABSENT_WITHOUT_LEAVE">Absent</SelectItem>
                        <SelectItem value="POLICY_VIOLATION">Policy Violation</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount (PKR)</Label>
                    <Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for fine..." required />
                </div>
                <Button type="submit" variant="destructive" className="w-full" disabled={loading}>
                  {loading ? "Adding..." : "Add Fine"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Fines grouped by date */}
      {sortedDates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No fines for {monthName}.
          </CardContent>
        </Card>
      ) : (
        sortedDates.map((dateStr) => {
          const dayItems = grouped[dateStr];
          const dayFines = dayItems.filter((i: any) => i._type === "fine");
          const dayLeaves = dayItems.filter((i: any) => i._type === "leave");
          const dayTotal = dayFines.reduce((s: number, f: any) => s + (f.amount || 0), 0);
          const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE, MMMM d, yyyy");
          return (
            <Card key={dateStr}>
              <CardHeader className="pb-2 bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">{dateLabel}</CardTitle>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{dayItems.length} entr{dayItems.length !== 1 ? "ies" : "y"}</span>
                    {dayTotal > 0 && <span className="text-xs font-semibold text-red-600">PKR {dayTotal.toLocaleString()}</span>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/10">
                      <TableHead className="text-xs py-2">Employee</TableHead>
                      <TableHead className="text-xs py-2">Type</TableHead>
                      <TableHead className="text-xs py-2 text-right">Amount</TableHead>
                      <TableHead className="text-xs py-2">Details</TableHead>
                      <TableHead className="text-xs py-2 text-right">Source</TableHead>
                      {isAdmin && <TableHead className="text-xs py-2 text-center w-10"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dayFines.map((fine: any) => (
                      <TableRow key={fine.id} className="hover:bg-muted/5">
                        <TableCell className="py-2.5">
                          <span className="text-sm font-medium">{fine.user.firstName} {fine.user.lastName}</span>
                          <span className="text-xs text-muted-foreground ml-1">({fine.user.employeeId})</span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge className={`text-[10px] ${typeColors[fine.type] || typeColors.OTHER}`}>
                            {typeLabels[fine.type] || fine.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right py-2.5">
                          {fine.amount > 0 ? (
                            <span className="text-sm font-semibold text-red-600">PKR {fine.amount.toLocaleString()}</span>
                          ) : (
                            <span className="text-sm text-green-600">Covered</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-xs text-muted-foreground">{fine.reason}</span>
                        </TableCell>
                        <TableCell className="text-right py-2.5">
                          <span className="text-xs text-muted-foreground">
                            {fine.reason?.startsWith("Auto-generated") || fine.reason?.startsWith("Late from break") || fine.reason?.startsWith("Absent")
                              ? "META7 AI"
                              : `${fine.issuedBy?.firstName || ""} ${fine.issuedBy?.lastName || ""}`}
                          </span>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-center py-2.5">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => handleDeleteFine(fine.id)}>
                              <Trash2 className="size-3" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {dayLeaves.map((leave: any) => (
                      <TableRow key={leave.id} className="hover:bg-purple-50/30 dark:hover:bg-purple-950/10">
                        <TableCell className="py-2.5">
                          <span className="text-sm font-medium">{leave.user.firstName} {leave.user.lastName}</span>
                          <span className="text-xs text-muted-foreground ml-1">({leave.user.employeeId})</span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge className="text-[10px] bg-purple-100 text-purple-700 hover:bg-purple-100">
                            {leave.leaveType === "HALF_DAY" ? "Half Day" : leave.leaveType}
                            {leave.halfDayPeriod === "FIRST_HALF" ? " (1st)" : leave.halfDayPeriod === "SECOND_HALF" ? " (2nd)" : ""}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right py-2.5">
                          <Badge className={`text-[10px] ${leave.status === "APPROVED" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-red-100 text-red-700 hover:bg-red-100"}`}>
                            {leave.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-xs text-muted-foreground">{leave.reason}</span>
                        </TableCell>
                        <TableCell className="text-right py-2.5">
                          <span className="text-xs text-muted-foreground">META7 AI</span>
                        </TableCell>
                        {isAdmin && <TableCell className="py-2.5"></TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
