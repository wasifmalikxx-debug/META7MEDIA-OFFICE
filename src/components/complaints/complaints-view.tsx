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
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Inbox,
} from "lucide-react";
import { formatPKTDisplay, formatPKTTime } from "@/lib/pkt";

// ── Month grouping (PKT) ─────────────────────────────
// createdAt is stored PKT-shifted (nowPKT()), so its UTC fields ARE the PKT
// calendar values — group + label straight off them, no timezone math.
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function monthKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabelOf(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_LONG[(m || 1) - 1]} ${y}`;
}
function monthLabelShort(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_LONG[(m || 1) - 1].slice(0, 3)} ${y}`;
}
function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

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
  // Multi-office: user includes team + partner + office so the admin inbox
  // shows which partner the complainant reports to. Optional fields stay
  // tolerant of older response shapes.
  user: {
    id?: string;
    firstName: string;
    lastName: string | null;
    employeeId: string;
    team?: { name: string; partner: { firstName: string; lastName: string | null } | null } | null;
    department?: { name: string } | null;
    office?: { name: string } | null;
  };
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

interface TargetEmployee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string | null;
  department?: { name: string } | null;
  team?: { name: string } | null;
}

interface ComplaintsViewProps {
  initialComplaints: Complaint[];
  isAdmin: boolean;
  currentUserId: string;
  /** CEO-only — employees the CEO can launch a complaint against. */
  targetEmployees?: TargetEmployee[];
  /** Authoritative current PKT month (YYYY-MM) from the server — the month
   *  switcher's default. Falls back to "" for older callers. */
  currentMonthKey?: string;
}

const CATEGORIES = [
  { value: "BUG", label: "Bug / Issue", icon: Bug, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-100 dark:bg-rose-900/30" },
  { value: "PAYROLL", label: "Payroll", icon: Wallet, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  { value: "ATTENDANCE", label: "Attendance", icon: Calendar, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30" },
  { value: "HR", label: "HR", icon: Users, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-100 dark:bg-violet-900/30" },
  { value: "POLICY", label: "Policy", icon: FileText, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" },
  { value: "TECHNICAL", label: "Technical", icon: Wrench, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-100 dark:bg-cyan-900/30" },
  { value: "HARASSMENT", label: "Harassment", icon: AlertTriangle, color: "text-red-700 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30" },
  { value: "OTHER", label: "Other", icon: HelpCircle, color: "text-muted-foreground", bg: "bg-muted" },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  LOW: { label: "Low", bg: "bg-muted", text: "text-muted-foreground", ring: "ring-border" },
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

// Solid left-rail colour per status — lets the CEO scan status down the list
// without reading. Matches the status pill family.
const STATUS_RAIL: Record<string, string> = {
  OPEN: "bg-blue-500",
  IN_PROGRESS: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  RESOLVED: "bg-emerald-500",
  DENIED: "bg-rose-500",
};

// Deterministic avatar tint per person, so the same employee always gets the
// same colour and the CEO can recognise them at a glance.
const AVATAR_PALETTE = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
];
function initialsOf(first: string, last?: string | null): string {
  const a = (first || "").trim()[0] || "";
  const b = (last || "").trim()[0] || "";
  return ((a + b) || a || "?").toUpperCase();
}
function avatarColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

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
  const CatIcon = cat?.icon;
  const employeeName = `${c.user.firstName} ${c.user.lastName || ""}`.trim();
  const lastMessage = c.messages?.[0];
  const unread = isAdmin ? c.unreadByCeo : c.unreadByEmployee;
  const rail = STATUS_RAIL[c.status] || STATUS_RAIL.OPEN;
  const teamLabel = c.user.team?.name ?? c.user.department?.name;
  // Prefix the preview with who spoke last: "You" for the CEO's own view,
  // "CEO" for the employee's view.
  const ceoPrefix = isAdmin ? "You: " : "CEO: ";

  return (
    <Card
      className={`relative overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-px transition-all cursor-pointer group ${unread ? "ring-1 ring-violet-300 dark:ring-violet-800" : ""}`}
      onClick={() => onOpen(c.id)}
    >
      {/* status rail — colour-coded left edge for at-a-glance status */}
      <span className={`absolute inset-y-0 left-0 w-1 ${rail}`} aria-hidden />
      <CardContent className="p-3 pl-4">
        <div className="flex items-start gap-3">
          {/* Avatar: CEO view shows the employee's initials (scan by person);
              employee's own view shows the category icon. */}
          {isAdmin ? (
            <div className={`size-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${avatarColor(c.user.employeeId || employeeName)}`}>
              {initialsOf(c.user.firstName, c.user.lastName)}
            </div>
          ) : (
            <div className={`size-10 rounded-full flex items-center justify-center shrink-0 ${cat?.bg || "bg-muted"}`}>
              {CatIcon && <CatIcon className={`size-5 ${cat?.color}`} />}
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Row 1: identity (admin) or subject (employee) + priority/status */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {isAdmin ? (
                  <>
                    <span className="font-semibold text-sm truncate">{employeeName}</span>
                    <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{c.user.employeeId}</span>
                  </>
                ) : (
                  <span className="font-semibold text-[13px] truncate">{c.subject}</span>
                )}
                {unread && <span className="size-1.5 rounded-full bg-violet-500 animate-pulse shrink-0" />}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <PriorityPill priority={c.priority} />
                <StatusPill status={c.status} />
              </div>
            </div>

            {/* Row 2: subject (CEO view only — employee already shows it above) */}
            {isAdmin && <div className="font-medium text-[13px] truncate mt-1">{c.subject}</div>}

            {/* Row 3: latest-message preview */}
            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
              {lastMessage ? (
                <>
                  {lastMessage.senderRole === "CEO" && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{ceoPrefix}</span>}
                  {lastMessage.message}
                </>
              ) : (
                c.description
              )}
            </p>

            {/* Row 4: meta — team + category on the left, dates pushed right */}
            <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground mt-2 flex-wrap">
              {isAdmin && teamLabel && (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-normal shrink-0">
                  {teamLabel}
                  {c.user.team?.partner && (
                    <span className="ml-1 text-muted-foreground/70">· {c.user.team.partner.firstName}</span>
                  )}
                  {c.user.office?.name && (
                    <span className="ml-1 text-muted-foreground/50">· {c.user.office.name.replace(/^META7MEDIA\s*/i, "")}</span>
                  )}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                {CatIcon && <CatIcon className={`size-3 ${cat?.color}`} />}
                {cat?.label}
              </span>
              <span className="ml-auto flex items-center gap-3 shrink-0">
                <span className="flex items-center gap-1" title={`Filed ${formatPKTDisplay(new Date(c.createdAt), "EEE, MMM d, yyyy")}`}>
                  <CalendarDays className="size-3" />
                  Filed {formatPKTDisplay(new Date(c.createdAt), "MMM d")}
                </span>
                <span className="flex items-center gap-1" title={`Last activity ${formatPKTDisplay(new Date(c.updatedAt), "EEE, MMM d, yyyy")} · ${formatPKTTime(new Date(c.updatedAt))}`}>
                  <Clock className="size-3" />
                  {formatPKTDisplay(new Date(c.updatedAt), "MMM d")} · {formatPKTTime(new Date(c.updatedAt))}
                </span>
                {(c._count?.messages ?? 0) > 1 && (
                  <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400 font-medium">
                    <MessageSquare className="size-3" />
                    {c._count?.messages}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ComplaintsView({ initialComplaints, isAdmin, currentUserId, targetEmployees = [], currentMonthKey = "" }: ComplaintsViewProps) {
  const router = useRouter();
  const [complaints, setComplaints] = useState<Complaint[]>(initialComplaints);
  // Fallback current month if the server prop is missing (older callers):
  // derive it from the newest complaint, else today via the browser.
  const resolvedCurrentMonth =
    currentMonthKey ||
    (initialComplaints[0] ? monthKeyOf(initialComplaints[0].createdAt) : (() => {
      const n = new Date();
      return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
    })());
  // Which month the CEO is browsing (admin only). Employees see their full list.
  const [selectedMonth, setSelectedMonth] = useState<string>(resolvedCurrentMonth);
  const [newOpen, setNewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<Complaint | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [form, setForm] = useState({
    subject: "",
    category: "BUG",
    priority: "MEDIUM",
    description: "",
    targetUserId: "", // CEO-only — employee the complaint is against
  });
  const [messageInput, setMessageInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [formImage, setFormImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  // Active filter for the redesigned list. "active" = OPEN + IN_PROGRESS,
  // i.e. anything still needing attention. Defaults to that since the
  // CEO/employee mostly cares about what's outstanding when they open the
  // page. Click any pill to switch — no section dividers needed below.
  const [filter, setFilter] = useState<"all" | "active" | "resolved" | "denied">("active");
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

  // LIVE CHAT POLLING — while the dialog is open AND the tab is visible,
  // refetch the complaint every 15 seconds (was 4s — too aggressive, was exhausting
  // the Supabase connection pool). Pauses entirely when the tab is in background.
  useEffect(() => {
    if (!viewing) {
      viewingIdRef.current = null;
      return;
    }
    viewingIdRef.current = viewing.id;

    async function pollOnce() {
      if (!viewingIdRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return; // pause when hidden
      try {
        const res = await fetch(`/api/complaints/${viewingIdRef.current}`);
        if (!res.ok) return;
        const data: Complaint = await res.json();
        setViewing((prev) => {
          if (!prev || prev.id !== data.id) return prev;
          const prevCount = (prev.messages || []).length;
          const newCount = (data.messages || []).length;
          if (prevCount === newCount && prev.status === data.status) return prev;
          return data;
        });
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
    }

    const interval = setInterval(pollOnce, 15000);
    // Also refetch immediately when the tab becomes visible again
    const onVis = () => { if (!document.hidden) pollOnce(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [viewing?.id]);

  // LIVE LIST POLLING — refetch the complaint list every 60 seconds when the
  // dialog is CLOSED and the tab is visible. Was 15s — too frequent.
  useEffect(() => {
    if (viewing) return;

    async function pollList() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/complaints");
        if (!res.ok) return;
        const data = await res.json();
        setComplaints(data);
      } catch {}
    }

    const interval = setInterval(pollList, 60000);
    const onVis = () => { if (!document.hidden) pollList(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [viewing]);

  // CEO-only — refresh the page (and thus the targetEmployees prop) every
  // 30s so newly-hired employees appear in the Launch dialog picker
  // without requiring a manual reload.
  useEffect(() => {
    if (!isAdmin) return;
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [isAdmin, router]);

  // Months present in the data (newest first). Always include the current
  // month and whatever's selected so the switcher never has a dangling value.
  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    for (const c of complaints) keys.add(monthKeyOf(c.createdAt));
    keys.add(resolvedCurrentMonth);
    keys.add(selectedMonth);
    return Array.from(keys).sort().reverse();
  }, [complaints, resolvedCurrentMonth, selectedMonth]);

  // Count per month for the switcher dropdown badges.
  const monthCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of complaints) {
      const k = monthKeyOf(c.createdAt);
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [complaints]);

  // Admin browses one month at a time; employees see their full (small) list.
  const monthComplaints = useMemo(
    () => (isAdmin ? complaints.filter((c) => monthKeyOf(c.createdAt) === selectedMonth) : complaints),
    [complaints, isAdmin, selectedMonth],
  );

  const monthIndex = availableMonths.indexOf(selectedMonth);
  const goOlderMonth = () => {
    if (monthIndex < availableMonths.length - 1) setSelectedMonth(availableMonths[monthIndex + 1]);
  };
  const goNewerMonth = () => {
    if (monthIndex > 0) setSelectedMonth(availableMonths[monthIndex - 1]);
  };

  const stats = useMemo(() => {
    return {
      open: monthComplaints.filter((c) => c.status === "OPEN").length,
      inProgress: monthComplaints.filter((c) => c.status === "IN_PROGRESS").length,
      resolved: monthComplaints.filter((c) => c.status === "RESOLVED" || c.status === "APPROVED").length,
      denied: monthComplaints.filter((c) => c.status === "DENIED").length,
      urgent: monthComplaints.filter((c) => c.priority === "URGENT" && c.status !== "RESOLVED" && c.status !== "DENIED").length,
      total: monthComplaints.length,
    };
  }, [monthComplaints]);

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
    if (isAdmin && !form.targetUserId) {
      toast.error("Pick the employee this complaint is against");
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
      toast.success(
        isAdmin
          ? "Complaint sent — the employee has been notified"
          : "Complaint submitted — delivered securely to the CEO",
      );
      setComplaints([data, ...complaints]);
      // A newly filed complaint lands in the current month — snap the switcher
      // there so the CEO isn't left staring at a past month wondering where it went.
      setSelectedMonth(resolvedCurrentMonth);
      setForm({ subject: "", category: "BUG", priority: "MEDIUM", description: "", targetUserId: "" });
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

  // Filter pill metadata + the actual filtered list. `active` collapses
  // OPEN + IN_PROGRESS into one bucket since both states need attention —
  // the CEO doesn't actually need to distinguish "I haven't read yet" from
  // "I started replying" at the list level (the chat thread shows that).
  const counts = {
    all: stats.total,
    active: stats.open + stats.inProgress,
    resolved: stats.resolved,
    denied: stats.denied,
  };
  const filteredComplaints = monthComplaints.filter((c) => {
    if (filter === "all") return true;
    if (filter === "active") return c.status === "OPEN" || c.status === "IN_PROGRESS";
    if (filter === "resolved") return c.status === "RESOLVED" || c.status === "APPROVED";
    if (filter === "denied") return c.status === "DENIED";
    return true;
  });

  const filterPills: { key: typeof filter; label: string; count: number; activeClass: string }[] = [
    { key: "all", label: "All", count: counts.all, activeClass: "bg-foreground text-background" },
    { key: "active", label: "Active", count: counts.active, activeClass: "bg-blue-600 text-white" },
    { key: "resolved", label: "Resolved", count: counts.resolved, activeClass: "bg-emerald-600 text-white" },
    { key: "denied", label: "Denied", count: counts.denied, activeClass: "bg-rose-600 text-white" },
  ];

  return (
    <div className="space-y-4">
      {/* MONTH SWITCHER (CEO only) — browse requests by month. Requests are now
          kept on a rolling 12-month history instead of being wiped on the 1st,
          so past months are reviewable here. */}
      {isAdmin && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border bg-card shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={goOlderMonth}
                disabled={monthIndex >= availableMonths.length - 1}
                className="h-9 px-2.5 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Older month"
              >
                <ChevronLeft className="size-4" />
              </button>
              <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
                <SelectTrigger className="h-9 min-w-[150px] justify-center border-x border-y-0 rounded-none shadow-none font-semibold focus-visible:ring-0">
                  <CalendarDays className="size-4 text-violet-500" />
                  <span>{monthLabelOf(selectedMonth)}</span>
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.map((k) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        {monthLabelOf(k)}
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {monthCounts[k] || 0}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={goNewerMonth}
                disabled={monthIndex <= 0}
                className="h-9 px-2.5 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Newer month"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            {selectedMonth !== resolvedCurrentMonth && (
              <button
                type="button"
                onClick={() => setSelectedMonth(resolvedCurrentMonth)}
                className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap"
              >
                Back to this month
              </button>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            <span className="font-semibold text-foreground">{monthComplaints.length}</span>{" "}
            {monthComplaints.length === 1 ? "request" : "requests"} in {monthLabelShort(selectedMonth)}
          </span>
        </div>
      )}

      {/* Toolbar — filter pills on the left, New Complaint on the right.
          Replaces the previous five-card KPI row + standalone button row.
          Filter pills double as counters AND filters; one element instead
          of two stacked. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="inline-flex items-center rounded-xl border bg-muted/40 p-1 self-start sm:self-auto overflow-x-auto">
          {filterPills.map((p) => {
            const isActive = filter === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setFilter(p.key)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  isActive ? `${p.activeClass} shadow-sm` : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
                <span className={`text-[10px] font-mono px-1.5 py-0 rounded ${
                  isActive ? "bg-white/20" : "bg-foreground/10"
                }`}>
                  {p.count}
                </span>
              </button>
            );
          })}
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger
            render={
              <Button
                size="default"
                className="gap-2 rounded-xl bg-gradient-to-br from-violet-600 via-violet-600 to-fuchsia-600 hover:from-violet-700 hover:via-violet-700 hover:to-fuchsia-700 text-white shadow-lg shadow-violet-500/25 transition-all px-5 font-semibold"
              >
                <MessageSquare className="size-4" />
                {isAdmin ? "New Complaint" : "File Complaint"}
              </Button>
            }
          />
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <div className="size-8 rounded-lg bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 flex items-center justify-center">
                  <ShieldCheck className="size-4 text-violet-600 dark:text-violet-400" />
                </div>
                {isAdmin ? "New Complaint" : "File a Complaint"}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                {isAdmin
                  ? "Open a private, confidential thread with a specific employee."
                  : "A direct, private line to the CEO. Speak honestly."}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-900 p-3 flex gap-3">
              <Lock className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  Secure · Encrypted · Confidential
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  {isAdmin
                    ? "Only you and the targeted employee can see this thread. It's kept on record and organized by month."
                    : "Every complaint is stored securely and handled one-to-one with the CEO. Your coworkers and managers never see this. Speak honestly."}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">
                    Employee <span className="text-rose-500">*</span>
                  </Label>
                  <Select
                    value={form.targetUserId}
                    onValueChange={(v) => v && setForm({ ...form, targetUserId: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={`Pick from ${targetEmployees.length} employees`} />
                    </SelectTrigger>
                    <SelectContent>
                      {targetEmployees.map((e) => {
                        const dept = e.department?.name ? ` · ${e.department.name}` : "";
                        return (
                          <SelectItem key={e.id} value={e.id}>
                            <span className="font-mono text-[10px] text-muted-foreground mr-1.5">{e.employeeId}</span>
                            {e.firstName} {e.lastName || ""}
                            <span className="text-[10px] text-muted-foreground">{dept}</span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    List refreshes automatically every 30s — newly hired employees appear without reload.
                  </p>
                </div>
              )}

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

      {/* Context note — accurate now that requests are retained per month. */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <Sparkles className="size-3 text-violet-500" />
        <span>
          {isAdmin
            ? "Requests are saved by month — use the month switcher above to review past requests. A rolling 12-month history is kept."
            : "A private, confidential line to the CEO. Only you and the CEO ever see this — speak honestly."}
        </span>
      </div>

      {/* Flat filtered list. The previous Open / Closed / Denied section
          headers are gone; the filter pills above carry that distinction
          now. One scrollable list, sorted by recency, no extra chrome. */}
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
      ) : isAdmin && monthComplaints.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-14 text-center">
            <div className="size-12 mx-auto rounded-2xl bg-muted flex items-center justify-center mb-3">
              <Inbox className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">No requests in {monthLabelOf(selectedMonth)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use the month switcher above to review other months.
            </p>
          </CardContent>
        </Card>
      ) : filteredComplaints.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-semibold text-muted-foreground">
              {filter === "active" && "No active requests this month — you're all caught up."}
              {filter === "resolved" && "No resolved requests in this month."}
              {filter === "denied" && "No denied requests this month."}
              {filter === "all" && "No requests found."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredComplaints.map((c) => (
            <ComplaintCard key={c.id} c={c} isAdmin={isAdmin} onOpen={openComplaint} />
          ))}
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
                  {/* Filed date — always visible so the CEO immediately knows
                      when a request came in, even months later. */}
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                    <CalendarDays className="size-3 shrink-0" />
                    <span className="truncate">
                      Filed {formatPKTDisplay(new Date(viewing.createdAt), "EEE, MMM d, yyyy")} · {formatPKTTime(new Date(viewing.createdAt))}
                    </span>
                  </div>
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
                  (() => {
                    const msgs = (viewing.messages || []).filter(isFullMessage);
                    let lastDay = "";
                    return msgs.map((m) => {
                    const isMine = m.senderId === currentUserId;
                    const isCeoMessage = m.senderRole === "CEO";
                    const senderName = `${m.sender.firstName} ${m.sender.lastName || ""}`.trim();
                    const dk = dayKeyOf(m.createdAt);
                    const showDay = dk !== lastDay;
                    lastDay = dk;
                    return (
                      <div key={m.id}>
                        {showDay && (
                          <div className="flex items-center justify-center my-3">
                            <span className="text-[9px] font-semibold text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
                              {formatPKTDisplay(new Date(m.createdAt), "EEE, MMM d, yyyy")}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
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
                      </div>
                    );
                    });
                  })()
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

      {/* Image lightbox — fullscreen preview. The default DialogContent close
          button is dark text on a near-black background, so we suppress it
          with showCloseButton=false and render our own white-on-translucent
          control alongside the Download button. */}
      <Dialog open={!!lightboxImage} onOpenChange={(o) => !o && setLightboxImage(null)}>
        <DialogContent
          className="p-0 bg-black/95 border-0 flex items-center justify-center"
          style={{ width: "98vw", maxWidth: "98vw", height: "96vh", maxHeight: "96vh" }}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Attachment preview</DialogTitle>
          {lightboxImage && (
            <>
              <img
                src={lightboxImage}
                alt="Attachment"
                className="max-w-full max-h-full object-contain"
              />
              <a
                href={lightboxImage}
                download="complaint-attachment.jpg"
                className="absolute top-3 right-16 text-white bg-white/10 hover:bg-white/20 backdrop-blur px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                onClick={(e) => e.stopPropagation()}
                title="Download image"
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </a>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="absolute top-3 right-3 size-9 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur text-white flex items-center justify-center transition-colors"
                aria-label="Close preview"
                title="Close (Esc)"
              >
                <X className="size-4" />
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
