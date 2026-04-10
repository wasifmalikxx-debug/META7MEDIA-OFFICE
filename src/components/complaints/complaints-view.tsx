"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Lock,
  ShieldCheck,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Bug,
  Wallet,
  Calendar,
  Users,
  FileText,
  Wrench,
  AlertTriangle,
  HelpCircle,
  Trash2,
  Send,
  Sparkles,
  CheckCheck,
  Ban,
  PlayCircle,
} from "lucide-react";
import { formatPKTDisplay, formatPKTTime } from "@/lib/pkt";

interface ComplaintMessage {
  id: string;
  senderId: string;
  senderRole: string;
  message: string;
  createdAt: string;
  sender: { firstName: string; lastName: string | null; employeeId: string };
}

interface MessagePreview {
  message: string;
  senderRole: string;
  createdAt: string;
}

interface Complaint {
  id: string;
  userId: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  unreadByCeo: boolean;
  unreadByEmployee: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id?: string; firstName: string; lastName: string | null; employeeId: string };
  resolvedBy: { firstName: string; lastName: string | null } | null;
  _count?: { messages: number };
  // In list view: last message preview. In detail view: full thread
  messages?: (ComplaintMessage | MessagePreview)[];
}

function isFullMessage(m: ComplaintMessage | MessagePreview): m is ComplaintMessage {
  return "id" in m;
}

interface ComplaintsViewProps {
  initialComplaints: Complaint[];
  isAdmin: boolean;
  currentUserId: string;
}

const CATEGORIES = [
  { value: "BUG", label: "Bug / Issue", icon: Bug, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-100 dark:bg-rose-900/30" },
  { value: "PAYROLL", label: "Payroll", icon: Wallet, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  { value: "ATTENDANCE", label: "Attendance", icon: Calendar, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30" },
  { value: "HR", label: "HR", icon: Users, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-100 dark:bg-violet-900/30" },
  { value: "POLICY", label: "Policy", icon: FileText, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" },
  { value: "TECHNICAL", label: "Technical", icon: Wrench, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-100 dark:bg-cyan-900/30" },
  { value: "HARASSMENT", label: "Harassment", icon: AlertTriangle, color: "text-red-700 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30" },
  { value: "OTHER", label: "Other", icon: HelpCircle, color: "text-slate-600 dark:text-slate-400", bg: "bg-slate-100 dark:bg-slate-800" },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  LOW: { label: "Low", bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-400", ring: "ring-slate-200 dark:ring-slate-700" },
  MEDIUM: { label: "Medium", bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", ring: "ring-blue-200 dark:ring-blue-800" },
  HIGH: { label: "High", bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", ring: "ring-amber-200 dark:ring-amber-800" },
  URGENT: { label: "Urgent", bg: "bg-rose-100 dark:bg-rose-900/30", text: "text-rose-700 dark:text-rose-400", ring: "ring-rose-200 dark:ring-rose-800" },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: any; border: string }> = {
  OPEN: { label: "Open", bg: "bg-blue-50 dark:bg-blue-950/40", text: "text-blue-700 dark:text-blue-400", icon: AlertCircle, border: "border-blue-200 dark:border-blue-900" },
  IN_PROGRESS: { label: "In Progress", bg: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-400", icon: Loader2, border: "border-amber-200 dark:border-amber-900" },
  APPROVED: { label: "Approved", bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle2, border: "border-emerald-200 dark:border-emerald-900" },
  RESOLVED: { label: "Resolved", bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400", icon: CheckCheck, border: "border-emerald-200 dark:border-emerald-900" },
  DENIED: { label: "Denied", bg: "bg-rose-50 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-400", icon: Ban, border: "border-rose-200 dark:border-rose-900" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.OPEN;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <Icon className="size-3" />
      {cfg.label}
    </span>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.MEDIUM;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function CategoryIcon({ category, size = "md" }: { category: string; size?: "sm" | "md" }) {
  const cfg = CATEGORY_MAP[category];
  if (!cfg) return null;
  const Icon = cfg.icon;
  const sizeCls = size === "sm" ? "size-7" : "size-9";
  const iconCls = size === "sm" ? "size-3.5" : "size-4";
  return (
    <div className={`${sizeCls} rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
      <Icon className={`${iconCls} ${cfg.color}`} />
    </div>
  );
}

export function ComplaintsView({ initialComplaints, isAdmin, currentUserId }: ComplaintsViewProps) {
  const router = useRouter();
  const [complaints, setComplaints] = useState<Complaint[]>(initialComplaints);
  const [newOpen, setNewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<Complaint | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [form, setForm] = useState({
    subject: "",
    category: "BUG",
    priority: "MEDIUM",
    description: "",
  });
  const [messageInput, setMessageInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the chat to the bottom when a new message is added or dialog opens
  useEffect(() => {
    if (viewing && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [viewing?.messages?.length]);

  const filtered = useMemo(() => {
    return complaints.filter((c) => {
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (filterCategory !== "all" && c.category !== filterCategory) return false;
      return true;
    });
  }, [complaints, filterStatus, filterCategory]);

  const stats = useMemo(() => {
    return {
      open: complaints.filter((c) => c.status === "OPEN").length,
      inProgress: complaints.filter((c) => c.status === "IN_PROGRESS").length,
      resolved: complaints.filter((c) => c.status === "RESOLVED" || c.status === "APPROVED").length,
      denied: complaints.filter((c) => c.status === "DENIED").length,
      urgent: complaints.filter((c) => c.priority === "URGENT" && c.status !== "RESOLVED" && c.status !== "DENIED").length,
      total: complaints.length,
    };
  }, [complaints]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.subject.trim().length < 3) {
      toast.error("Subject must be at least 3 characters");
      return;
    }
    if (form.description.trim().length < 10) {
      toast.error("Please describe the issue in at least 10 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      toast.success("Complaint submitted — delivered securely to the CEO");
      setComplaints([data, ...complaints]);
      setForm({ subject: "", category: "BUG", priority: "MEDIUM", description: "" });
      setNewOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function openComplaint(id: string) {
    setViewingLoading(true);
    try {
      const res = await fetch(`/api/complaints/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setViewing(data);
      setMessageInput("");
      // Refresh list to clear unread flag
      setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, unreadByCeo: isAdmin ? false : c.unreadByCeo, unreadByEmployee: !isAdmin ? false : c.unreadByEmployee } : c)));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setViewingLoading(false);
    }
  }

  async function sendMessage() {
    if (!viewing) return;
    const text = messageInput.trim();
    if (!text) return;
    if (viewing.status === "RESOLVED" || viewing.status === "DENIED") {
      toast.error("This complaint is closed.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/complaints/${viewing.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Append to the thread and clear input
      setViewing({
        ...viewing,
        messages: [...(viewing.messages || []), data],
        status: isAdmin && viewing.status === "OPEN" ? "IN_PROGRESS" : viewing.status,
        updatedAt: data.createdAt,
      });
      setMessageInput("");
      // Also update the list entry's count + last message
      setComplaints((prev) =>
        prev.map((c) =>
          c.id === viewing.id
            ? {
                ...c,
                _count: { messages: (c._count?.messages ?? 0) + 1 },
                updatedAt: data.createdAt,
                status: isAdmin && c.status === "OPEN" ? "IN_PROGRESS" : c.status,
                messages: [{ message: data.message, senderRole: data.senderRole, createdAt: data.createdAt }],
              }
            : c
        )
      );
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(newStatus: string) {
    if (!viewing) return;
    if (newStatus === viewing.status) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/complaints/${viewing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setViewing(data);
      setComplaints((prev) => prev.map((c) => (c.id === data.id ? { ...c, status: data.status, resolvedAt: data.resolvedAt, updatedAt: data.updatedAt } : c)));
      const labels: Record<string, string> = {
        OPEN: "reopened", IN_PROGRESS: "set to in progress", APPROVED: "approved", RESOLVED: "resolved", DENIED: "denied",
      };
      toast.success(`Complaint ${labels[newStatus] || "updated"}`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteComplaint(id: string) {
    if (!confirm("Permanently delete this complaint and its entire conversation? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/complaints/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Complaint deleted");
      setComplaints((prev) => prev.filter((c) => c.id !== id));
      setViewing(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const isClosed = viewing && (viewing.status === "RESOLVED" || viewing.status === "DENIED");

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="size-3.5 text-blue-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Open</p>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.open}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 className="size-3.5 text-amber-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">In Progress</p>
            </div>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{stats.inProgress}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Resolved</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{stats.resolved}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="size-3.5 text-rose-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Denied</p>
            </div>
            <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">{stats.denied}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-800 sm:col-span-2 lg:col-span-1">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="size-3.5 text-violet-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total</p>
            </div>
            <p className="text-3xl font-bold text-violet-600 dark:text-violet-400">{stats.total}</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly reset notice */}
      <div className="rounded-lg border border-violet-200 dark:border-violet-900/50 bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/30 px-4 py-2.5 flex items-center gap-3">
        <Sparkles className="size-4 text-violet-600 dark:text-violet-400 shrink-0" />
        <p className="text-[11px] text-violet-800 dark:text-violet-300">
          <strong>Fresh every month.</strong> All complaints automatically reset on the 1st of each month — speak freely, nothing is kept long-term.
        </p>
      </div>

      {/* Header with filters + submit button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v || "all")}>
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
              <SelectItem value="DENIED">Denied</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v || "all")}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2 rounded-lg">
                <Plus className="size-4" />
                Launch Complaint
              </Button>
            }
          />
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-600" />
                Launch a Complaint
              </DialogTitle>
              <DialogDescription>
                Direct private channel to the CEO. Report anything.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-900 p-3 flex gap-3">
              <Lock className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  Secure · Encrypted · Confidential
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  Every complaint is stored securely and handled one-to-one with the CEO. Your coworkers and managers
                  never see this. All complaints reset automatically on the 1st of every month. Speak honestly.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Subject</Label>
                <Input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Short summary of your complaint"
                  className="h-9"
                  maxLength={120}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Category</Label>
                  <Select value={form.category} onValueChange={(v) => v && setForm({ ...form, category: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          <div className="flex items-center gap-2">
                            <c.icon className={`size-3.5 ${c.color}`} />
                            {c.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => v && setForm({ ...form, priority: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="URGENT">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">What's going on?</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Tell the CEO what happened, when, and what you'd like resolved."
                  rows={6}
                  className="resize-none"
                  maxLength={2000}
                  required
                />
                <p className="text-[10px] text-muted-foreground">{form.description.length} / 2000</p>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={loading} className="gap-2">
                  <Send className="size-4" />
                  {loading ? "Sending..." : "Submit Securely"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Complaint list */}
      {filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 mx-auto rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 dark:from-violet-950/50 dark:to-fuchsia-950/50 flex items-center justify-center mb-3">
              <MessageSquare className="size-7 text-violet-500" />
            </div>
            <p className="text-sm font-semibold">No complaints yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isAdmin ? "No complaints match your filters." : "You can launch a complaint any time — it stays completely confidential."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2.5">
          {filtered.map((c) => {
            const cat = CATEGORY_MAP[c.category];
            const employeeName = `${c.user.firstName} ${c.user.lastName || ""}`.trim();
            const lastMessage = c.messages?.[0];
            const unread = isAdmin ? c.unreadByCeo : c.unreadByEmployee;
            return (
              <Card
                key={c.id}
                className={`border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group ${unread ? "ring-2 ring-violet-300 dark:ring-violet-700" : ""}`}
                onClick={() => openComplaint(c.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CategoryIcon category={c.category} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <h3 className="font-semibold text-sm truncate flex items-center gap-2">
                          {c.subject}
                          {unread && <span className="size-1.5 rounded-full bg-violet-500 animate-pulse" />}
                        </h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <PriorityPill priority={c.priority} />
                          <StatusPill status={c.status} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
                        {lastMessage ? (
                          <>
                            {lastMessage.senderRole === "CEO" && <span className="font-semibold text-emerald-600 dark:text-emerald-400">CEO: </span>}
                            {lastMessage.message}
                          </>
                        ) : (
                          c.description
                        )}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        {isAdmin && (
                          <span className="flex items-center gap-1 font-medium">
                            <Users className="size-3" />
                            {employeeName} · {c.user.employeeId}
                          </span>
                        )}
                        <span className="text-muted-foreground/70">{cat?.label}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatPKTDisplay(new Date(c.updatedAt), "MMM d")} · {formatPKTTime(new Date(c.updatedAt))}
                        </span>
                        {(c._count?.messages ?? 0) > 1 && (
                          <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400 font-medium">
                            <MessageSquare className="size-3" />
                            {c._count?.messages} messages
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Chat dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) { setViewing(null); setMessageInput(""); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] p-0 overflow-hidden flex flex-col">
          {viewing && (
            <>
              {/* Header */}
              <DialogHeader className="px-5 py-4 border-b bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
                <div className="flex items-start gap-3">
                  <CategoryIcon category={viewing.category} />
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-base pr-8 truncate">{viewing.subject}</DialogTitle>
                    <DialogDescription className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <PriorityPill priority={viewing.priority} />
                      <StatusPill status={viewing.status} />
                      {isAdmin && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          · {viewing.user.firstName} {viewing.user.lastName || ""} ({viewing.user.employeeId})
                        </span>
                      )}
                    </DialogDescription>
                  </div>
                </div>

                {/* CEO status actions */}
                {isAdmin && (
                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    {viewing.status !== "IN_PROGRESS" && !isClosed && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => changeStatus("IN_PROGRESS")} disabled={loading}>
                        <PlayCircle className="size-3" /> In Progress
                      </Button>
                    )}
                    {!isClosed && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30" onClick={() => changeStatus("APPROVED")} disabled={loading}>
                          <CheckCircle2 className="size-3" /> Approved
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" onClick={() => changeStatus("RESOLVED")} disabled={loading}>
                          <CheckCheck className="size-3" /> Mark Resolved
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/30" onClick={() => changeStatus("DENIED")} disabled={loading}>
                          <Ban className="size-3" /> Deny
                        </Button>
                      </>
                    )}
                    {isClosed && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => changeStatus("IN_PROGRESS")} disabled={loading}>
                        <PlayCircle className="size-3" /> Reopen
                      </Button>
                    )}
                    <div className="ml-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] gap-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        onClick={() => deleteComplaint(viewing.id)}
                      >
                        <Trash2 className="size-3" /> Delete
                      </Button>
                    </div>
                  </div>
                )}
              </DialogHeader>

              {/* Message thread */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-muted/5">
                {viewingLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin mr-2" /> Loading...
                  </div>
                ) : (
                  (viewing.messages || []).filter(isFullMessage).map((m) => {
                    const isMine = m.senderId === currentUserId;
                    const isCeoMessage = m.senderRole === "CEO";
                    const senderName = `${m.sender.firstName} ${m.sender.lastName || ""}`.trim();
                    return (
                      <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] ${isMine ? "order-2" : "order-1"}`}>
                          <div className={`flex items-center gap-1.5 mb-1 ${isMine ? "justify-end" : "justify-start"}`}>
                            <span className="text-[10px] font-semibold text-muted-foreground">
                              {isMine ? "You" : senderName}
                            </span>
                            {isCeoMessage && (
                              <Badge variant="outline" className="h-4 px-1 text-[8px] border-emerald-400 text-emerald-700 dark:text-emerald-400">
                                CEO
                              </Badge>
                            )}
                            <span className="text-[9px] text-muted-foreground/60">
                              {formatPKTDisplay(new Date(m.createdAt), "MMM d")} · {formatPKTTime(new Date(m.createdAt))}
                            </span>
                          </div>
                          <div
                            className={`rounded-2xl px-3.5 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                              isMine
                                ? "bg-violet-600 text-white rounded-tr-sm"
                                : isCeoMessage
                                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 border border-emerald-200 dark:border-emerald-900 rounded-tl-sm"
                                : "bg-white dark:bg-slate-900 border border-border rounded-tl-sm"
                            }`}
                          >
                            {m.message}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {isClosed && (
                  <div className="flex items-center justify-center py-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                      {viewing.status === "RESOLVED" ? (
                        <><CheckCheck className="size-3 text-emerald-600" /> Resolved</>
                      ) : (
                        <><Ban className="size-3 text-rose-600" /> Denied</>
                      )}
                      {viewing.resolvedAt && (
                        <span>on {formatPKTDisplay(new Date(viewing.resolvedAt), "MMM d")}</span>
                      )}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              {!isClosed ? (
                <div className="border-t px-5 py-3 bg-background">
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder={isAdmin ? "Write a response to the employee..." : "Reply to the CEO..."}
                      rows={2}
                      className="resize-none text-xs"
                      maxLength={4000}
                    />
                    <Button onClick={sendMessage} disabled={loading || !messageInput.trim()} className="gap-1.5 shrink-0 h-auto self-stretch">
                      <Send className="size-4" />
                      Send
                    </Button>
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1.5">Press ⌘/Ctrl + Enter to send</p>
                </div>
              ) : (
                <div className="border-t px-5 py-3 bg-muted/20 text-center">
                  <p className="text-[11px] text-muted-foreground">
                    This complaint is closed. {isAdmin && "Click 'Reopen' above to continue the conversation."}
                  </p>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
