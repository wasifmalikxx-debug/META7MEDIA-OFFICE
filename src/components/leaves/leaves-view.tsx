"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Check,
  X,
  Calendar,
  Clock,
  Heart,
  Briefcase,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Hourglass,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface MonthlyUsage {
  budget: number;
  halfDayUsed: number;
  absentCoverUsed: number;
  totalUsed: number;
  remaining: number;
  exhausted: boolean;
}

interface LeavesViewProps {
  leaves: any[];
  balance: {
    casualTotal: number;
    casualUsed: number;
    sickTotal: number;
    sickUsed: number;
  } | null;
  monthlyUsage: MonthlyUsage | null;
  isAdmin: boolean;
  userId: string;
  currentMonth: number;
  currentYear: number;
}

// ─── Visual config — matches portal palette ─────────────────────────

const TYPE_META: Record<
  string,
  { label: string; tone: string; ring: string; icon: typeof Heart }
> = {
  CASUAL:    { label: "Casual",     tone: "text-violet-700 dark:text-violet-300",   ring: "bg-violet-50 dark:bg-violet-950/30 ring-violet-200 dark:ring-violet-900/50",   icon: Briefcase },
  SICK:      { label: "Sick",       tone: "text-rose-700 dark:text-rose-300",       ring: "bg-rose-50 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900/50",         icon: Heart },
  UNPAID:    { label: "Unpaid",     tone: "text-foreground",     ring: "bg-muted ring-border",       icon: AlertCircle },
  EMERGENCY: { label: "Emergency",  tone: "text-amber-700 dark:text-amber-300",     ring: "bg-amber-50 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-900/50",     icon: Sparkles },
  HALF_DAY:  { label: "Half Day",   tone: "text-blue-700 dark:text-blue-300",       ring: "bg-blue-50 dark:bg-blue-950/30 ring-blue-200 dark:ring-blue-900/50",         icon: Clock },
};

const STATUS_META: Record<
  string,
  { label: string; tone: string; ring: string; icon: typeof CheckCircle2 }
> = {
  PENDING:   { label: "Pending",   tone: "text-amber-700 dark:text-amber-300",     ring: "bg-amber-50 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-900/50",     icon: Hourglass },
  APPROVED:  { label: "Approved",  tone: "text-emerald-700 dark:text-emerald-300", ring: "bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-900/50", icon: CheckCircle2 },
  REJECTED:  { label: "Rejected",  tone: "text-rose-700 dark:text-rose-300",       ring: "bg-rose-50 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900/50",         icon: XCircle },
  CANCELLED: { label: "Cancelled", tone: "text-muted-foreground",     ring: "bg-muted ring-border",       icon: X },
};

// ─── Small inline atoms ─────────────────────────────────────────────

function TypePill({ type }: { type: string }) {
  const m = TYPE_META[type] ?? TYPE_META.CASUAL;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.ring} ${m.tone}`}>
      <Icon className="size-3" />
      {m.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.PENDING;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.ring} ${m.tone}`}>
      <Icon className="size-3" />
      {m.label}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-muted to-accent text-[10px] font-bold text-foreground shrink-0">
      {initials || "?"}
    </div>
  );
}

// ─── Main view ──────────────────────────────────────────────────────

export function LeavesView({
  leaves,
  balance,
  monthlyUsage,
  isAdmin,
  currentMonth,
  currentYear,
}: LeavesViewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [form, setForm] = useState({
    leaveType: "CASUAL",
    halfDayPeriod: "" as string,
    startDate: "",
    endDate: "",
    reason: "",
  });

  // Pending → top section for managers. Always visible separately because
  // an unanswered request blocks the employee from planning.
  const pendingLeaves = leaves.filter((l) => l.status === "PENDING");
  const visibleLeaves = isAdmin
    ? leaves.filter((l) => l.status !== "PENDING")
    : leaves;
  const filteredByStatus =
    statusFilter === "ALL"
      ? visibleLeaves
      : visibleLeaves.filter((l) => l.status === statusFilter);

  // Derived stats for the overview strip on the admin view.
  const stats = useMemo(() => {
    const total = leaves.length;
    const approved = leaves.filter((l) => l.status === "APPROVED").length;
    const pending = pendingLeaves.length;
    const rejected = leaves.filter((l) => l.status === "REJECTED").length;
    return { total, approved, pending, rejected };
  }, [leaves, pendingLeaves.length]);

  // Estimated days for the apply-form preview chip.
  const estimatedDays = useMemo(() => {
    if (form.leaveType === "HALF_DAY") return 0.5;
    if (!form.startDate || !form.endDate) return null;
    const a = new Date(form.startDate);
    const b = new Date(form.endDate);
    const diff = Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : null;
  }, [form.leaveType, form.startDate, form.endDate]);

  // Today in PKT (YYYY-MM-DD) for the half-day "same day = second half only" rule.
  const todayPKT = useMemo(() => {
    const p = new Date(Date.now() + 5 * 60 * 60_000);
    return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}-${String(p.getUTCDate()).padStart(2, "0")}`;
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.leaveType === "HALF_DAY" && !form.halfDayPeriod) {
      toast.error("Please select First Half or Second Half");
      return;
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (form.leaveType !== "HALF_DAY") delete payload.halfDayPeriod;
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Leave request submitted");
      setOpen(false);
      setForm({ leaveType: "CASUAL", halfDayPeriod: "", startDate: "", endDate: "", reason: "" });
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(leaveId: string, action: "APPROVED" | "REJECTED") {
    try {
      const res = await fetch(`/api/leaves/${leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success(action === "APPROVED" ? "Leave approved" : "Leave rejected");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* EMPLOYEE HERO — Monthly unified leave-budget snapshot */}
      {!isAdmin && monthlyUsage && (
        <MonthlyBudgetHero
          usage={monthlyUsage}
          monthLabel={format(new Date(Date.UTC(currentYear, currentMonth - 1, 1)), "MMMM yyyy")}
        />
      )}

      {/* EMPLOYEE — Annual balance cards */}
      {!isAdmin && balance && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <BalanceCard
            label="Casual Leave"
            sub="Annual entitlement"
            used={balance.casualUsed}
            total={balance.casualTotal}
            tone="violet"
            Icon={Briefcase}
          />
          <BalanceCard
            label="Sick Leave"
            sub="Annual entitlement"
            used={balance.sickUsed}
            total={balance.sickTotal}
            tone="rose"
            Icon={Heart}
          />
        </div>
      )}

      {/* ADMIN — Stats strip + pending approvals */}
      {isAdmin && <AdminOverview stats={stats} />}
      {isAdmin && pendingLeaves.length > 0 && (
        <PendingApprovals leaves={pendingLeaves} onAction={handleAction} />
      )}

      {/* Actions row — apply button (employees) + status filter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isAdmin ? "Resolved requests" : "Your requests"}
          </span>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as any)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="size-4" /> Apply for leave
            </DialogTrigger>
            <DialogContent className="max-w-[480px]">
              <DialogHeader>
                <DialogTitle>Apply for leave</DialogTitle>
              </DialogHeader>
              <ApplyLeaveForm
                form={form}
                setForm={setForm}
                loading={loading}
                onSubmit={handleSubmit}
                todayPKT={todayPKT}
                estimatedDays={estimatedDays}
                monthlyUsage={monthlyUsage}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Main listing — month-grouped cards with rows */}
      {filteredByStatus.length === 0 ? (
        <EmptyState isAdmin={isAdmin} hasFilter={statusFilter !== "ALL"} />
      ) : (
        <LeaveMonthGroups leaves={filteredByStatus} isAdmin={isAdmin} />
      )}
    </div>
  );
}

// ─── Hero: Monthly Budget ───────────────────────────────────────────

function MonthlyBudgetHero({ usage, monthLabel }: { usage: MonthlyUsage; monthLabel: string }) {
  const pct = Math.min(100, Math.round((usage.totalUsed / Math.max(0.01, usage.budget)) * 100));
  const status = usage.exhausted
    ? { bar: "bg-rose-500", chip: "bg-rose-50 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900/50 text-rose-700 dark:text-rose-300", label: "Exhausted" }
    : usage.remaining < usage.budget
      ? { bar: "bg-amber-500", chip: "bg-amber-50 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-900/50 text-amber-700 dark:text-amber-300", label: "Partially used" }
      : { bar: "bg-emerald-500", chip: "bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-900/50 text-emerald-700 dark:text-emerald-300", label: "Full budget" };

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Monthly leave budget</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Unified pool · resets 1st of every month · {monthLabel}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.chip}`}>
            <Calendar className="size-3" /> {status.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Stat
            label="Budget"
            value={usage.budget.toFixed(1)}
            suffix="day"
            sub="Monthly entitlement"
          />
          <Stat
            label="Used"
            value={usage.totalUsed.toFixed(1)}
            suffix="day"
            sub={`${usage.absentCoverUsed.toFixed(1)} absent · ${usage.halfDayUsed.toFixed(1)} half-day`}
            tone={usage.totalUsed > 0 ? "amber" : undefined}
          />
          <Stat
            label="Remaining"
            value={usage.remaining.toFixed(1)}
            suffix="day"
            sub={usage.exhausted ? "Further requests will be rejected" : "Available this month"}
            tone={usage.exhausted ? "rose" : "emerald"}
          />
        </div>
        <div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full ${status.bar} transition-all`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
            One pool covers BOTH auto-cover for unplanned absences (consumes 1.0 day) AND half-day leaves (consumes 0.5 day each).
            Once exhausted, further absences deduct salary/30 and new half-day requests are blocked.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  suffix,
  sub,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  tone?: "emerald" | "amber" | "rose";
}) {
  const valTone =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "rose"
          ? "text-rose-700 dark:text-rose-400"
          : "text-foreground";
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${valTone} mt-1`}>
        {value}
        {suffix && <span className="text-sm font-medium text-muted-foreground ml-1">{suffix}</span>}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

// ─── Annual balance card ────────────────────────────────────────────

function BalanceCard({
  label,
  sub,
  used,
  total,
  tone,
  Icon,
}: {
  label: string;
  sub: string;
  used: number;
  total: number;
  tone: "violet" | "rose";
  Icon: typeof Heart;
}) {
  const remaining = Math.max(0, total - used);
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const accent =
    tone === "violet"
      ? { text: "text-violet-700 dark:text-violet-300", bg: "bg-violet-50 dark:bg-violet-950/30", ring: "ring-violet-200 dark:ring-violet-900/50", bar: "bg-violet-500" }
      : { text: "text-rose-700 dark:text-rose-300",     bg: "bg-rose-50 dark:bg-rose-950/30",     ring: "ring-rose-200 dark:ring-rose-900/50",     bar: "bg-rose-500"     };

  return (
    <Card size="sm">
      <CardContent className="px-4">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-[11px] text-muted-foreground">{sub}</p>
          </div>
          <span className={`flex size-8 items-center justify-center rounded-md ring-1 ring-inset ${accent.bg} ${accent.ring}`}>
            <Icon className={`size-4 ${accent.text}`} />
          </span>
        </div>
        <div className="flex items-baseline gap-2 mt-3">
          <span className={`text-2xl font-bold tabular-nums ${accent.text}`}>{remaining}</span>
          <span className="text-sm text-muted-foreground">of {total} remaining</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-3">
          <div className={`h-full ${accent.bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          {used} day{used === 1 ? "" : "s"} used this year
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Admin overview + pending approvals ─────────────────────────────

function AdminOverview({
  stats,
}: {
  stats: { total: number; approved: number; pending: number; rejected: number };
}) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
      <MiniStat label="Total" value={stats.total} icon={Calendar} tone="slate" />
      <MiniStat label="Pending" value={stats.pending} icon={Hourglass} tone="amber" />
      <MiniStat label="Approved" value={stats.approved} icon={CheckCircle2} tone="emerald" />
      <MiniStat label="Rejected" value={stats.rejected} icon={XCircle} tone="rose" />
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Calendar;
  tone: "slate" | "amber" | "emerald" | "rose";
}) {
  const accent: Record<typeof tone, { bg: string; ring: string; text: string }> = {
    slate:   { bg: "bg-muted",     ring: "ring-border",       text: "text-foreground" },
    amber:   { bg: "bg-amber-50 dark:bg-amber-950/30",     ring: "ring-amber-200 dark:ring-amber-900/50",   text: "text-amber-700 dark:text-amber-300" },
    emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/30", ring: "ring-emerald-200 dark:ring-emerald-900/50", text: "text-emerald-700 dark:text-emerald-300" },
    rose:    { bg: "bg-rose-50 dark:bg-rose-950/30",       ring: "ring-rose-200 dark:ring-rose-900/50",     text: "text-rose-700 dark:text-rose-300" },
  };
  const a = accent[tone];
  return (
    <Card size="sm">
      <CardContent className="px-4 flex items-center gap-3">
        <span className={`flex size-9 items-center justify-center rounded-md ring-1 ring-inset ${a.bg} ${a.ring}`}>
          <Icon className={`size-4 ${a.text}`} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className={`text-xl font-bold tabular-nums ${a.text}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingApprovals({
  leaves,
  onAction,
}: {
  leaves: any[];
  onAction: (id: string, action: "APPROVED" | "REJECTED") => void;
}) {
  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Hourglass className="size-4 text-amber-600 dark:text-amber-400" />
            Awaiting your decision
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {leaves.length} pending
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {leaves.map((leave: any) => {
          const name = `${leave.user.firstName} ${leave.user.lastName || ""}`.trim();
          return (
            <div
              key={leave.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5"
            >
              <Avatar name={name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {name}{" "}
                  <span className="text-xs text-muted-foreground">({leave.user.employeeId})</span>
                </p>
                <p className="text-xs text-muted-foreground truncate">{leave.reason}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <TypePill type={leave.leaveType} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {format(new Date(leave.startDate), "MMM d")} · {leave.totalDays}d
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => onAction(leave.id, "APPROVED")}
                >
                  <Check className="size-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  onClick={() => onAction(leave.id, "REJECTED")}
                >
                  <X className="size-3.5" /> Reject
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Apply Leave dialog body ────────────────────────────────────────

function ApplyLeaveForm({
  form,
  setForm,
  loading,
  onSubmit,
  todayPKT,
  estimatedDays,
  monthlyUsage,
}: {
  form: { leaveType: string; halfDayPeriod: string; startDate: string; endDate: string; reason: string };
  setForm: (f: any) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  todayPKT: string;
  estimatedDays: number | null;
  monthlyUsage: MonthlyUsage | null;
}) {
  const isHalfDayBlocked =
    form.leaveType === "HALF_DAY" && !!monthlyUsage && monthlyUsage.remaining < 0.5;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Budget-impact banner — only for half-day */}
      {form.leaveType === "HALF_DAY" && monthlyUsage && (
        <div
          className={`rounded-md px-3 py-2 text-xs ring-1 ring-inset ${
            isHalfDayBlocked
              ? "bg-rose-50 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900/50 text-rose-700 dark:text-rose-300"
              : "bg-blue-50 dark:bg-blue-950/30 ring-blue-200 dark:ring-blue-900/50 text-blue-700 dark:text-blue-300"
          }`}
        >
          <p className="font-medium">
            Monthly budget: {monthlyUsage.remaining.toFixed(1)} / {monthlyUsage.budget.toFixed(1)} day remaining
          </p>
          <p className="opacity-90 mt-0.5">
            {isHalfDayBlocked
              ? "Budget exhausted — this half-day will be rejected. Apply as Unpaid Leave instead."
              : `This half-day will consume 0.5 day, leaving ${(monthlyUsage.remaining - 0.5).toFixed(1)} day.`}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label>Leave Type</Label>
        <Select value={form.leaveType} onValueChange={(v) => v && setForm({ ...form, leaveType: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CASUAL">Casual Leave</SelectItem>
            <SelectItem value="SICK">Sick Leave</SelectItem>
            <SelectItem value="HALF_DAY">Half Day</SelectItem>
            <SelectItem value="UNPAID">Unpaid Leave</SelectItem>
            <SelectItem value="EMERGENCY">Emergency Leave</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.leaveType === "HALF_DAY" && (
        <div className="space-y-2">
          <Label>Half Day Period</Label>
          <Select
            value={form.halfDayPeriod}
            onValueChange={(v) => v && setForm({ ...form, halfDayPeriod: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {form.startDate && form.startDate === todayPKT ? (
                <SelectItem value="SECOND_HALF">Second Half (leave after break)</SelectItem>
              ) : (
                <>
                  <SelectItem value="FIRST_HALF">First Half (arrive after break)</SelectItem>
                  <SelectItem value="SECOND_HALF">Second Half (leave after break)</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Start Date</Label>
          <Input
            type="date"
            value={form.startDate}
            onChange={(e) =>
              setForm({
                ...form,
                startDate: e.target.value,
                endDate:
                  form.leaveType === "HALF_DAY" || !form.endDate
                    ? e.target.value
                    : form.endDate,
              })
            }
            required
          />
        </div>
        <div className="space-y-2">
          <Label>End Date</Label>
          <Input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            required
            disabled={form.leaveType === "HALF_DAY"}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Reason</Label>
        <Textarea
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          placeholder="Brief reason for the leave (visible to your manager + CEO)"
          required
          rows={3}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        {estimatedDays !== null ? (
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{estimatedDays}</span> day{estimatedDays === 1 ? "" : "s"} requested
          </span>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={loading || isHalfDayBlocked}>
          {loading ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}

// ─── Month-grouped listing ──────────────────────────────────────────

function LeaveMonthGroups({ leaves, isAdmin }: { leaves: any[]; isAdmin: boolean }) {
  const byMonth: Record<string, any[]> = {};
  for (const l of leaves) {
    const d = new Date(l.startDate);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(l);
  }
  const monthKeys = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return format(new Date(Date.UTC(y, m - 1, 1)), "MMMM yyyy");
  };

  return (
    <div className="space-y-4">
      {monthKeys.map((key) => {
        const rows = byMonth[key];
        const totalDays = rows.reduce((s: number, r: any) => s + (r.totalDays || 0), 0);
        return (
          <Card key={key}>
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">{monthLabel(key)}</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {rows.length} request{rows.length === 1 ? "" : "s"} · {totalDays} day{totalDays === 1 ? "" : "s"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    {isAdmin && (
                      <TableHead className="text-[10px] font-semibold uppercase tracking-wider pl-4">
                        Employee
                      </TableHead>
                    )}
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">
                      Type
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">
                      Dates
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-right">
                      Days
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">
                      Status
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">
                      Reason
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((leave: any) => {
                    const name = `${leave.user.firstName} ${leave.user.lastName || ""}`.trim();
                    return (
                      <TableRow key={leave.id} className="hover:bg-muted/30 transition-colors">
                        {isAdmin && (
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-2">
                              <Avatar name={name} />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{name}</p>
                                <p className="text-[10px] text-muted-foreground tabular-nums">
                                  {leave.user.employeeId}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <TypePill type={leave.leaveType} />
                            {leave.leaveType === "HALF_DAY" && leave.halfDayPeriod && (
                              <span className="text-[10px] text-muted-foreground">
                                {leave.halfDayPeriod === "FIRST_HALF" ? "1st" : "2nd"}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums whitespace-nowrap">
                          {leave.startDate === leave.endDate
                            ? format(new Date(leave.startDate), "MMM d, yyyy")
                            : `${format(new Date(leave.startDate), "MMM d")} — ${format(new Date(leave.endDate), "MMM d, yyyy")}`}
                        </TableCell>
                        <TableCell className="text-sm font-medium tabular-nums text-right">
                          {leave.totalDays}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={leave.status} />
                        </TableCell>
                        <TableCell className="text-sm max-w-[280px] truncate text-muted-foreground">
                          {leave.reason}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────

function EmptyState({ isAdmin, hasFilter }: { isAdmin: boolean; hasFilter: boolean }) {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted mb-3">
          <Calendar className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">
          {hasFilter
            ? "No leaves match this filter"
            : isAdmin
              ? "No leave requests yet"
              : "You haven't requested any leave"}
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          {hasFilter
            ? "Try a different status filter."
            : isAdmin
              ? "Approved and rejected requests will appear here."
              : "Use the Apply for leave button above to submit your first request."}
        </p>
      </CardContent>
    </Card>
  );
}
