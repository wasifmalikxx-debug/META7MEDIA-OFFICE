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
  Paperclip,
  ImageIcon,
  X,
} from "lucide-react";
import { formatPKTDisplay, formatPKTTime } from "@/lib/pkt";

interface ComplaintMessage {
  id: string;
  senderId: string;
  senderRole: string;
  message: string;
  imageUrl?: string | null;
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

/**
 * Compress an image file to a small JPEG data URL.
 * Resizes so the longest side is max 1600px, encodes at 0.82 quality.
 * Result is typically 100–400 KB even for large photos.
 */
async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_SIDE = 1600;
        let { width, height } = img;
        if (width > MAX_SIDE || height > MAX_SIDE) {
          if (width > height) {
            height = Math.round((height * MAX_SIDE) / width);
            width = MAX_SIDE;
          } else {
            width = Math.round((width * MAX_SIDE) / height);
            height = MAX_SIDE;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        // White background for transparent PNGs so the JPEG doesn't turn black
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
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

function ComplaintCard({ c, isAdmin, onOpen }: { c: Complaint; isAdmin: boolean; onOpen: (id: string) => void }) {
  const cat = CATEGORY_MAP[c.category];
  const employeeName = `${c.user.firstName} ${c.user.lastName || ""}`.trim();
  const lastMessage = c.messages?.[0];
  const unread = isAdmin ? c.unreadByCeo : c.unreadByEmployee;
  return (
    <Card
      className={`border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group ${unread ? "ring-2 ring-violet-300 dark:ring-violet-700" : ""}`}
      onClick={() => onOpen(c.id)}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start gap-3">
          <CategoryIcon category={c.category} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="font-semibold text-xs truncate flex items-center gap-2">
                {c.subject}
                {unread && <span className="size-1.5 rounded-full bg-violet-500 animate-pulse" />}
              </h3>
              <div className="flex items-center gap-1 shrink-0">
                <PriorityPill priority={c.priority} />
                <StatusPill status={c.status} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground line-clamp-1 mb-1.5">
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
                  {c._count?.messages}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ComplaintSection({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  bgColor,
  complaints,
  isAdmin,
  emptyText,
  onOpen,
}: {
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  bgColor: string;
  complaints: Complaint[];
  isAdmin: boolean;
  emptyText: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <div className={`size-8 rounded-lg ${bgColor} flex items-center justify-center`}>
          <Icon className={`size-4 ${iconColor}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-bold">{title}</h2>
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-bold">
              {complaints.length}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {complaints.length === 0 ? (
        <Card className="border-0 shadow-sm bg-muted/10">
          <CardContent className="py-6 text-center">
            <p className="text-[11px] text-muted-foreground">{emptyText}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {complaints.map((c) => (
            <ComplaintCard key={c.id} c={c} isAdmin={isAdmin} onOpen={onOpen} />
          ))}
        </div>
      )}
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
  const [form, setForm] = useState({
    subject: "",
    category: "BUG",
    priority: "MEDIUM",
    description: "",
  });
  const [messageInput, setMessageInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [formImage, setFormImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const viewingIdRef = useRef<string | null>(null);

  // Auto-scroll the chat to the bottom when a new message is added or dialog opens
  useEffect(() => {
    if (viewing && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [viewing?.messages?.length]);

  // LIVE CHAT POLLING — while the dialog is open, refetch the complaint every 4 seconds
  // to pick up new messages from the other side in near real-time
  useEffect(() => {
    if (!viewing) {
      viewingIdRef.current = null;
      return;
    }
    viewingIdRef.current = viewing.id;
    const interval = setInterval(async () => {
      if (!viewingIdRef.current) return;
      try {
        const res = await fetch(`/api/complaints/${viewingIdRef.current}`);
        if (!res.ok) return;
        const data: Complaint = await res.json();
        // Only update if something actually changed to avoid re-renders
        setViewing((prev) => {
          if (!prev || prev.id !== data.id) return prev;
          const prevCount = (prev.messages || []).length;
          const newCount = (data.messages || []).length;
          if (prevCount === newCount && prev.status === data.status) {
            return prev;
          }
          return data;
        });
        // Also keep the list card in sync
        setComplaints((prev) =>
          prev.map((c) =>
            c.id === data.id
              ? {
                  ...c,
                  status: data.status,
                  updatedAt: data.updatedAt,
                  resolvedAt: data.resolvedAt,
                  _count: { messages: (data.messages || []).length },
                  messages:
                    data.messages && data.messages.length > 0
                      ? [
                          {
                            message: data.messages[data.messages.length - 1].message,
                            senderRole: data.messages[data.messages.length - 1].senderRole,
                            createdAt: data.messages[data.messages.length - 1].createdAt,
                          },
                        ]
                      : c.messages,
                }
              : c
          )
        );
      } catch {}
    }, 4000);
    return () => clearInterval(interval);
  }, [viewing?.id]);

  // LIVE LIST POLLING — refetch the complaint list every 15 seconds when dialog is CLOSED
  // so new complaints and replies show up without manual refresh
  useEffect(() => {
    if (viewing) return; // don't poll the list while a chat is open (chat poll handles updates)
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/complaints");
        if (!res.ok) return;
        const data = await res.json();
        setComplaints(data);
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [viewing]);

  const grouped = useMemo(() => {
    const openCases: Complaint[] = [];
    const closedCases: Complaint[] = [];
    const deniedCases: Complaint[] = [];
    for (const c of complaints) {
      if (c.status === "OPEN" || c.status === "IN_PROGRESS") openCases.push(c);
      else if (c.status === "RESOLVED" || c.status === "APPROVED") closedCases.push(c);
      else if (c.status === "DENIED") deniedCases.push(c);
    }
    return { openCases, closedCases, deniedCases };
  }, [complaints]);

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
        body: JSON.stringify({ ...form, imageUrl: formImage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      toast.success("Complaint submitted — delivered securely to the CEO");
      setComplaints([data, ...complaints]);
      setForm({ subject: "", category: "BUG", priority: "MEDIUM", description: "" });
      setFormImage(null);
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

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files allowed");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10 MB");
      return;
    }
    setUploadingImage(true);
    try {
      // Compress client-side (resize + re-encode as JPEG) so the payload stays small
      const compressed = await compressImage(file);
      setAttachedImage(compressed);
    } catch (err: any) {
      toast.error(err.message || "Failed to process image");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleFormImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files allowed");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10 MB");
      return;
    }
    setUploadingImage(true);
    try {
      const compressed = await compressImage(file);
      setFormImage(compressed);
    } catch (err: any) {
      toast.error(err.message || "Failed to process image");
    } finally {
      setUploadingImage(false);
      if (formFileInputRef.current) formFileInputRef.current.value = "";
    }
  }

  async function sendMessage() {
    if (!viewing) return;
    const text = messageInput.trim();
    if (!text && !attachedImage) return;
    if (viewing.status === "RESOLVED" || viewing.status === "DENIED") {
      toast.error("This complaint is closed.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/complaints/${viewing.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, imageUrl: attachedImage }),
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
      setAttachedImage(null);
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

      {/* Launch button — employees only */}
      {!isAdmin && (
      <div className="flex items-center justify-end">
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

              {/* Screenshot attachment */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <ImageIcon className="size-3.5" />
                  Attach screenshot <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <input
                  ref={formFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFormImagePick}
                />
                {formImage ? (
                  <div className="relative inline-block">
                    <img
                      src={formImage}
                      alt="Preview"
                      className="h-32 w-auto rounded-lg border object-cover cursor-pointer"
                      onClick={() => setLightboxImage(formImage)}
                    />
                    <button
                      type="button"
                      onClick={() => setFormImage(null)}
                      className="absolute -top-2 -right-2 size-6 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 shadow-md"
                      title="Remove image"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-20 border-dashed gap-2 flex-col text-muted-foreground hover:text-violet-600 hover:border-violet-400"
                    onClick={() => formFileInputRef.current?.click()}
                    disabled={uploadingImage}
                  >
                    {uploadingImage ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span className="text-[10px]">Processing...</span>
                      </>
                    ) : (
                      <>
                        <Paperclip className="size-4" />
                        <span className="text-[10px]">Click to attach a screenshot (JPG, PNG, WebP)</span>
                      </>
                    )}
                  </Button>
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => { setNewOpen(false); setFormImage(null); }}>Cancel</Button>
                <Button type="submit" disabled={loading || uploadingImage} className="gap-2">
                  <Send className="size-4" />
                  {loading ? "Sending..." : "Submit Securely"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      )}

      {/* Grouped sections: Open Cases / Closed / Denied */}
      {complaints.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 mx-auto rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 dark:from-violet-950/50 dark:to-fuchsia-950/50 flex items-center justify-center mb-3">
              <MessageSquare className="size-7 text-violet-500" />
            </div>
            <p className="text-sm font-semibold">No complaints yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isAdmin ? "Employee complaints will show up here." : "You can launch a complaint any time — it stays completely confidential."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <ComplaintSection
            title="Open Cases"
            subtitle="Active complaints needing attention"
            icon={AlertCircle}
            iconColor="text-blue-600 dark:text-blue-400"
            bgColor="bg-blue-50 dark:bg-blue-950/30"
            complaints={grouped.openCases}
            isAdmin={isAdmin}
            emptyText="No open cases. You're all caught up."
            onOpen={openComplaint}
          />
          <ComplaintSection
            title="Closed"
            subtitle="Resolved and approved complaints"
            icon={CheckCheck}
            iconColor="text-emerald-600 dark:text-emerald-400"
            bgColor="bg-emerald-50 dark:bg-emerald-950/30"
            complaints={grouped.closedCases}
            isAdmin={isAdmin}
            emptyText="Nothing closed yet."
            onOpen={openComplaint}
          />
          <ComplaintSection
            title="Denied"
            subtitle="Complaints that were denied"
            icon={Ban}
            iconColor="text-rose-600 dark:text-rose-400"
            bgColor="bg-rose-50 dark:bg-rose-950/30"
            complaints={grouped.deniedCases}
            isAdmin={isAdmin}
            emptyText="No denied complaints."
            onOpen={openComplaint}
          />
        </div>
      )}

      {/* Chat dialog — compact, professional */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) { setViewing(null); setMessageInput(""); setAttachedImage(null); } }}>
        <DialogContent className="max-w-xl p-0 overflow-hidden flex flex-col gap-0" style={{ height: "min(640px, 85vh)" }}>
          {viewing && (
            <>
              {/* Compact header */}
              <DialogHeader className="px-4 py-3 border-b bg-background flex-row items-center gap-3 space-y-0">
                <CategoryIcon category={viewing.category} size="sm" />
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-sm font-semibold truncate pr-8">{viewing.subject}</DialogTitle>
                  <DialogDescription className="flex items-center gap-1.5 mt-0.5">
                    <PriorityPill priority={viewing.priority} />
                    <StatusPill status={viewing.status} />
                    {isAdmin && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        · {viewing.user.firstName} {viewing.user.lastName || ""} · {viewing.user.employeeId}
                      </span>
                    )}
                  </DialogDescription>
                </div>
              </DialogHeader>

              {/* CEO status action bar */}
              {isAdmin && (
                <div className="border-b bg-muted/20 px-4 py-2 flex items-center gap-1.5 flex-wrap">
                  {!isClosed && viewing.status !== "IN_PROGRESS" && (
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 px-2" onClick={() => changeStatus("IN_PROGRESS")} disabled={loading}>
                      <PlayCircle className="size-3" /> In Progress
                    </Button>
                  )}
                  {!isClosed && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 px-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400" onClick={() => changeStatus("RESOLVED")} disabled={loading}>
                        <CheckCheck className="size-3" /> Mark Resolved
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 px-2 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400" onClick={() => changeStatus("DENIED")} disabled={loading}>
                        <Ban className="size-3" /> Deny
                      </Button>
                    </>
                  )}
                  {isClosed && (
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 px-2" onClick={() => changeStatus("IN_PROGRESS")} disabled={loading}>
                      <PlayCircle className="size-3" /> Reopen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 ml-auto text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    onClick={() => deleteComplaint(viewing.id)}
                    title="Delete complaint"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}

              {/* Message thread */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-muted/5">
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
                        <div className="max-w-[78%]">
                          <div className={`flex items-center gap-1.5 mb-0.5 ${isMine ? "justify-end" : "justify-start"}`}>
                            <span className="text-[9px] font-semibold text-muted-foreground">
                              {isMine ? "You" : senderName}
                            </span>
                            {isCeoMessage && !isMine && (
                              <span className="h-3.5 px-1 rounded text-[7px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                                CEO
                              </span>
                            )}
                            <span className="text-[9px] text-muted-foreground/60">
                              {formatPKTTime(new Date(m.createdAt))}
                            </span>
                          </div>
                          <div
                            className={`rounded-2xl text-[11px] leading-relaxed whitespace-pre-wrap ${
                              isMine
                                ? "bg-violet-600 text-white rounded-tr-md"
                                : isCeoMessage
                                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 border border-emerald-200 dark:border-emerald-900 rounded-tl-md"
                                : "bg-white dark:bg-slate-900 border border-border rounded-tl-md"
                            } ${m.imageUrl && !m.message ? "p-1" : "px-3 py-2"}`}
                          >
                            {m.imageUrl && (
                              <img
                                src={m.imageUrl}
                                alt="Attachment"
                                className="rounded-lg max-w-full max-h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => setLightboxImage(m.imageUrl || null)}
                              />
                            )}
                            {m.message && (
                              <div className={m.imageUrl ? "mt-1.5 px-2 pb-1" : ""}>{m.message}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {isClosed && (
                  <div className="flex items-center justify-center py-2">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                      {viewing.status === "RESOLVED" ? (
                        <><CheckCheck className="size-3 text-emerald-600" /> Resolved</>
                      ) : (
                        <><Ban className="size-3 text-rose-600" /> Denied</>
                      )}
                      {viewing.resolvedAt && (
                        <span>· {formatPKTDisplay(new Date(viewing.resolvedAt), "MMM d")}</span>
                      )}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              {!isClosed ? (
                <div className="border-t bg-background">
                  {/* Attached image preview */}
                  {attachedImage && (
                    <div className="px-4 pt-3 pb-1">
                      <div className="relative inline-block">
                        <img
                          src={attachedImage}
                          alt="Preview"
                          className="h-20 w-auto rounded-lg border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setAttachedImage(null)}
                          className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 shadow-sm"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="px-4 py-3 flex items-end gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleImagePick}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="size-9 p-0 shrink-0 text-muted-foreground hover:text-violet-600"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage || !!attachedImage}
                      title="Attach screenshot"
                    >
                      {uploadingImage ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Paperclip className="size-4" />
                      )}
                    </Button>
                    <Textarea
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder={isAdmin ? "Write a response..." : "Type a message..."}
                      rows={1}
                      className="resize-none text-xs min-h-[36px] max-h-[120px] py-2"
                      maxLength={4000}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={loading || (!messageInput.trim() && !attachedImage)}
                      size="sm"
                      className="size-9 p-0 shrink-0"
                      title="Send message"
                    >
                      {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    </Button>
                  </div>
                  <p className="text-[9px] text-muted-foreground px-4 pb-2">
                    Enter to send · Shift+Enter for newline · Attach screenshots via paperclip
                  </p>
                </div>
              ) : (
                <div className="border-t px-4 py-3 bg-muted/20 text-center">
                  <p className="text-[11px] text-muted-foreground">
                    This complaint is closed. {isAdmin && "Click 'Reopen' above to continue."}
                  </p>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Image lightbox */}
      <Dialog open={!!lightboxImage} onOpenChange={(o) => !o && setLightboxImage(null)}>
        <DialogContent className="max-w-4xl p-2 bg-black/95 border-0">
          <DialogTitle className="sr-only">Attachment preview</DialogTitle>
          {lightboxImage && (
            <img src={lightboxImage} alt="Attachment" className="w-full h-auto max-h-[80vh] object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
