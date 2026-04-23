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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus, ChevronLeft, ChevronRight, Trash2, Calendar, AlertTriangle,
  ShieldCheck, Clock, Ban, FileWarning, CalendarOff,
} from "lucide-react";

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
    date: new Date(Date.now() + 5 * 60 * 60_000).toISOString().split("T")[0],
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

  const coveredFines = fines.filter((f: any) => f.amount === 0);
  const actualFines = fines.filter((f: any) => f.amount > 0);
  const actualTotal = actualFines.reduce((s: number, f: any) => s + f.amount, 0);
  const lateFines = fines.filter((f: any) => f.type === "LATE_ARRIVAL").length;
  const absentFines = fines.filter((f: any) => f.type === "ABSENT_WITHOUT_LEAVE").length;
  const policyFines = fines.filter((f: any) => f.type === "POLICY_VIOLATION").length;

  const typeLabels: Record<string, string> = {
    LATE_ARRIVAL: "Late Arrival",
    EARLY_DEPARTURE: "Early Leave",
    ABSENT_WITHOUT_LEAVE: "Absent",
    POLICY_VIOLATION: "Policy",
    OTHER: "Other",
  };

  const typeColors: Record<string, string> = {
    LATE_ARRIVAL: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    EARLY_DEPARTURE: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    ABSENT_WITHOUT_LEAVE: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    POLICY_VIOLATION: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    OTHER: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
  };

  const typeIcons: Record<string, any> = {
    LATE_ARRIVAL: Clock,
    EARLY_DEPARTURE: Clock,
    ABSENT_WITHOUT_LEAVE: Ban,
    POLICY_VIOLATION: FileWarning,
    OTHER: AlertTriangle,
  };

  // Group employees by department name for the Select dropdown.
  const employeesByDept: Record<string, any[]> = {};
  employees.forEach((e: any) => {
    const name = e.department?.name || "Other";
    if (!employeesByDept[name]) employeesByDept[name] = [];
    employeesByDept[name].push(e);
  });
  const deptKeys = Object.keys(employeesByDept).sort();

  // Group fines + leaves by date
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => goMonth(-1)} className="size-9 rounded-full">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-[200px] justify-center">
            <Calendar className="size-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">{monthName}</h2>
          </div>
          <Button variant="outline" size="icon" onClick={() => goMonth(1)} className="size-9 rounded-full">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" variant="destructive" className="gap-1.5 rounded-lg" />}>
              <Plus className="size-4" /> Issue Fine
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px]">
              <DialogHeader>
                <DialogTitle className="text-lg">Issue Manual Fine</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Employee</Label>
                  <Select value={form.userId} onValueChange={(v) => v && setForm({ ...form, userId: v })}>
                    <SelectTrigger className="w-full h-10"><SelectValue placeholder="Select employee..." /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {deptKeys.map((dept, i) => (
                        <div key={dept}>
                          <div className={`px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/50 ${i > 0 ? "mt-1" : ""}`}>{dept}</div>
                          {employeesByDept[dept].map((emp: any) => (
                            <SelectItem key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeId})</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Type</Label>
                    <Select value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v })}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
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
                    <Label className="text-xs font-semibold">Amount (PKR)</Label>
                    <Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required className="h-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Reason</Label>
                  <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Describe the reason..." required rows={2} />
                </div>
                <Button type="submit" variant="destructive" className="w-full h-10 gap-2" disabled={loading}>
                  <AlertTriangle className="size-4" />
                  {loading ? "Issuing..." : "Issue Fine"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Fines</p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-0.5">PKR {actualTotal.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Late Fines</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">{lateFines}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-red-50 to-white dark:from-red-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Absent Fines</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-0.5">{absentFines}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Covered</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{coveredFines.length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Leaves</p>
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400 mt-0.5">{leaves.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Feed */}
      {sortedDates.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <ShieldCheck className="size-7 text-emerald-500/50" />
            </div>
            <p className="text-muted-foreground font-semibold">All Clear</p>
            <p className="text-xs text-muted-foreground/60 mt-1">No fines or activities for {monthName}</p>
          </CardContent>
        </Card>
      ) : (
        sortedDates.map((dateStr) => {
          const dayItems = grouped[dateStr];
          const dayFines = dayItems.filter((i: any) => i._type === "fine");
          const dayLeaves = dayItems.filter((i: any) => i._type === "leave");
          const dayTotal = dayFines.reduce((s: number, f: any) => s + (f.amount || 0), 0);
          const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE, MMMM d");
          return (
            <Card key={dateStr} className="border-0 shadow-sm overflow-hidden">
              <CardHeader className="py-2.5 px-5 bg-muted/30 border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-bold">{dateLabel}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] h-5">{dayItems.length} entr{dayItems.length !== 1 ? "ies" : "y"}</Badge>
                    {dayTotal > 0 && (
                      <Badge className="text-[9px] h-5 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-0">
                        PKR {dayTotal.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 divide-y divide-muted/30">
                {dayFines.map((fine: any) => {
                  const Icon = typeIcons[fine.type] || AlertTriangle;
                  return (
                    <div key={fine.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/20 transition-colors">
                      <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${typeColors[fine.type] || typeColors.OTHER}`}>
                        <Icon className="size-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{fine.user.firstName} {fine.user.lastName}</span>
                          <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">{fine.user.employeeId}</span>
                          <Badge className={`text-[9px] h-4 border-0 ${typeColors[fine.type] || typeColors.OTHER}`}>
                            {typeLabels[fine.type] || fine.type}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{fine.reason}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {fine.amount > 0 ? (
                          <span className="text-sm font-bold text-rose-600 dark:text-rose-400">PKR {fine.amount.toLocaleString()}</span>
                        ) : (
                          <Badge className="text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">Covered</Badge>
                        )}
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          {fine.reason?.startsWith("Auto-generated") || fine.reason?.startsWith("Late from break") || fine.reason?.startsWith("Absent") || fine.reason?.startsWith("Break skipped") || fine.reason?.startsWith("Daily report")
                            ? "System"
                            : `${fine.issuedBy?.firstName || ""} ${fine.issuedBy?.lastName || ""}`}
                        </p>
                      </div>
                      {isAdmin && (
                        <Button size="sm" variant="ghost" className="size-7 p-0 text-muted-foreground/40 hover:text-rose-600 shrink-0" onClick={() => handleDeleteFine(fine.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
                {dayLeaves.map((leave: any) => (
                  <div key={leave.id} className="flex items-center gap-4 px-5 py-3 hover:bg-violet-50/30 dark:hover:bg-violet-950/10 transition-colors">
                    <div className="size-8 rounded-lg flex items-center justify-center shrink-0 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                      <CalendarOff className="size-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{leave.user.firstName} {leave.user.lastName}</span>
                        <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">{leave.user.employeeId}</span>
                        <Badge className="text-[9px] h-4 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-0">
                          {leave.leaveType === "HALF_DAY" ? "Half Day" : leave.leaveType}
                          {leave.halfDayPeriod === "FIRST_HALF" ? " (1st)" : leave.halfDayPeriod === "SECOND_HALF" ? " (2nd)" : ""}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        <span className="font-medium">{format(new Date(leave.startDate), "EEE, MMM d")}</span> — {leave.reason}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge className={`text-[9px] ${leave.status === "APPROVED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"} border-0`}>
                        {leave.status}
                      </Badge>
                    </div>
                    {isAdmin && <div className="size-7 shrink-0" />}
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
