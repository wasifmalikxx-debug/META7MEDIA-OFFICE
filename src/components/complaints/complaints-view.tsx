"use client";

import { useState, useMemo } from "react";
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
  Eye,
} from "lucide-react";
import { formatPKTDisplay } from "@/lib/pkt";

interface Complaint {
  id: string;
  userId: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  ceoResponse: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { firstName: string; lastName: string | null; employeeId: string };
  respondedBy: { firstName: string; lastName: string | null } | null;
}

interface ComplaintsViewProps {
  initialComplaints: Complaint[];
  isAdmin: boolean;
  currentUserId: string;
}

const CATEGORIES = [
  { value: "BUG", label: "Bug / Issue", icon: Bug, color: "text-rose-600" },
  { value: "PAYROLL", label: "Payroll", icon: Wallet, color: "text-emerald-600" },
  { value: "ATTENDANCE", label: "Attendance", icon: Calendar, color: "text-blue-600" },
  { value: "HR", label: "HR", icon: Users, color: "text-violet-600" },
  { value: "POLICY", label: "Policy", icon: FileText, color: "text-amber-600" },
  { value: "TECHNICAL", label: "Technical", icon: Wrench, color: "text-cyan-600" },
  { value: "HARASSMENT", label: "Harassment", icon: AlertTriangle, color: "text-red-700" },
  { value: "OTHER", label: "Other", icon: HelpCircle, color: "text-slate-600" },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  LOW: { label: "Low", bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-400" },
  MEDIUM: { label: "Medium", bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400" },
  HIGH: { label: "High", bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400" },
  URGENT: { label: "Urgent", bg: "bg-rose-100 dark:bg-rose-900/30", text: "text-rose-700 dark:text-rose-400" },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  OPEN: { label: "Open", bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", icon: AlertCircle },
  IN_PROGRESS: { label: "In Progress", bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", icon: Loader2 },
  APPROVED: { label: "Approved", bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
  RESOLVED: { label: "Resolved", bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
  DENIED: { label: "Denied", bg: "bg-rose-100 dark:bg-rose-900/30", text: "text-rose-700 dark:text-rose-400", icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.OPEN;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
      <Icon className="size-3" />
      {cfg.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.MEDIUM;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function CategoryIcon({ category }: { category: string }) {
  const cfg = CATEGORY_MAP[category];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <div className={`size-8 rounded-lg bg-muted/40 flex items-center justify-center ${cfg.color}`}>
      <Icon className="size-4" />
    </div>
  );
}

export function ComplaintsView({ initialComplaints, isAdmin, currentUserId }: ComplaintsViewProps) {
  const router = useRouter();
  const [complaints, setComplaints] = useState(initialComplaints);
  const [newOpen, setNewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<Complaint | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [form, setForm] = useState({
    subject: "",
    category: "BUG",
    priority: "MEDIUM",
    description: "",
  });
  const [responseForm, setResponseForm] = useState({
    ceoResponse: "",
    status: "",
  });

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
      urgent: complaints.filter((c) => c.priority === "URGENT" && (c.status === "OPEN" || c.status === "IN_PROGRESS")).length,
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
      toast.success("Complaint submitted — your message is securely delivered to the CEO");
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

  async function handleRespond(complaint: Complaint) {
    if (!responseForm.ceoResponse.trim() && !responseForm.status) {
      toast.error("Enter a response or change the status");
      return;
    }
    setLoading(true);
    try {
      const payload: any = {};
      if (responseForm.ceoResponse.trim()) payload.ceoResponse = responseForm.ceoResponse.trim();
      if (responseForm.status && responseForm.status !== complaint.status) payload.status = responseForm.status;
      const res = await fetch(`/api/complaints/${complaint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Complaint updated");
      setComplaints(complaints.map((c) => (c.id === data.id ? data : c)));
      setViewing(data);
      setResponseForm({ ceoResponse: "", status: "" });
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this complaint? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/complaints/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success("Complaint deleted");
      setComplaints(complaints.filter((c) => c.id !== id));
      setViewing(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

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
        {!isAdmin && (
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
                  Submit a Complaint
                </DialogTitle>
                <DialogDescription>
                  Report any issue, bug, or concern directly to the CEO.
                </DialogDescription>
              </DialogHeader>

              {/* Privacy notice */}
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 p-3 flex gap-3">
                <Lock className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                    Private & Confidential
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                    Report any issue freely. Your complaint is securely stored, handled one-to-one with the CEO,
                    and never shared with coworkers or managers. Speak honestly — this is your safe channel.
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
                  <Label className="text-xs font-semibold">Description</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Explain the issue in detail — what happened, when, and what you'd like resolved."
                    rows={6}
                    className="resize-none"
                    maxLength={2000}
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">{form.description.length} / 2000 characters</p>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={loading} className="gap-2">
                    <Send className="size-4" />
                    {loading ? "Submitting..." : "Submit Securely"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Complaint list */}
      {filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center mb-3">
              <MessageSquare className="size-7 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold">No complaints yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isAdmin ? "No complaints match your filters." : "You can launch a complaint any time — it stays completely confidential."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((c) => {
            const cat = CATEGORY_MAP[c.category];
            const employeeName = `${c.user.firstName} ${c.user.lastName || ""}`.trim();
            return (
              <Card
                key={c.id}
                className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                onClick={() => {
                  setViewing(c);
                  setResponseForm({ ceoResponse: "", status: c.status });
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <CategoryIcon category={c.category} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <h3 className="font-semibold text-sm truncate">{c.subject}</h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <PriorityBadge priority={c.priority} />
                          <StatusBadge status={c.status} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{c.description}</p>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        {isAdmin && (
                          <span className="flex items-center gap-1">
                            <Users className="size-3" />
                            {employeeName} ({c.user.employeeId})
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatPKTDisplay(new Date(c.createdAt), "MMM d, yyyy")}
                        </span>
                        <span className="text-muted-foreground/50">{cat?.label}</span>
                        {c.ceoResponse && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <MessageSquare className="size-3" />
                            CEO responded
                          </span>
                        )}
                      </div>
                    </div>
                    <Eye className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* View / respond dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewing && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <CategoryIcon category={viewing.category} />
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-base">{viewing.subject}</DialogTitle>
                    <DialogDescription className="mt-1 flex items-center gap-2 flex-wrap">
                      <PriorityBadge priority={viewing.priority} />
                      <StatusBadge status={viewing.status} />
                      <span className="text-[10px]">
                        {formatPKTDisplay(new Date(viewing.createdAt), "EEEE, MMMM d, yyyy")}
                      </span>
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4">
                {isAdmin && (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                      Submitted by
                    </p>
                    <p className="text-sm font-semibold">
                      {viewing.user.firstName} {viewing.user.lastName || ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{viewing.user.employeeId}</p>
                  </div>
                )}

                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Description
                  </p>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <p className="text-xs whitespace-pre-wrap leading-relaxed">{viewing.description}</p>
                  </div>
                </div>

                {viewing.ceoResponse && (
                  <div>
                    <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <MessageSquare className="size-3" />
                      CEO Response
                    </p>
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 p-3">
                      <p className="text-xs whitespace-pre-wrap leading-relaxed text-emerald-900 dark:text-emerald-200">
                        {viewing.ceoResponse}
                      </p>
                      {viewing.respondedBy && viewing.respondedAt && (
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-2">
                          — {viewing.respondedBy.firstName} {viewing.respondedBy.lastName || ""} • {formatPKTDisplay(new Date(viewing.respondedAt), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {isAdmin && (
                  <div className="space-y-3 pt-2 border-t">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Respond / Update Status
                    </p>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Change Status</Label>
                      <Select
                        value={responseForm.status || viewing.status}
                        onValueChange={(v) => v && setResponseForm({ ...responseForm, status: v })}
                      >
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OPEN">Open</SelectItem>
                          <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                          <SelectItem value="APPROVED">Approved</SelectItem>
                          <SelectItem value="RESOLVED">Resolved</SelectItem>
                          <SelectItem value="DENIED">Denied</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        {viewing.ceoResponse ? "Add another note" : "Response to employee"}
                      </Label>
                      <Textarea
                        value={responseForm.ceoResponse}
                        onChange={(e) => setResponseForm({ ...responseForm, ceoResponse: e.target.value })}
                        placeholder="Write your response to the employee..."
                        rows={4}
                        className="resize-none"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1.5"
                        onClick={() => handleDelete(viewing.id)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                      <Button onClick={() => handleRespond(viewing)} disabled={loading} className="gap-2">
                        <Send className="size-4" />
                        {loading ? "Saving..." : "Save Update"}
                      </Button>
                    </div>
                  </div>
                )}

                {!isAdmin && viewing.status === "OPEN" && viewing.userId === currentUserId && (
                  <div className="pt-2 border-t flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1.5"
                      onClick={() => handleDelete(viewing.id)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete complaint
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
