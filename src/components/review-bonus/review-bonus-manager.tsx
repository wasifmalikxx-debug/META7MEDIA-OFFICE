"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, X, Eye, Star, ChevronLeft, ChevronRight, Calendar, Clock, CheckCircle, XCircle, Trash2, DollarSign } from "lucide-react";

interface Submission {
  id: string;
  userId: string;
  storeName: string;
  customerName: string | null;
  originalRating: number;
  newRating: number;
  beforeScreenshot: string;
  afterScreenshot: string;
  amount: number;
  status: string;
  rejectionReason: string | null;
  approvedBy: { firstName: string; lastName: string } | null;
  user: { firstName: string; lastName: string; employeeId: string };
  createdAt: string;
}

interface ReviewBonusManagerProps {
  submissions: Submission[];
  currentMonth: number;
  currentYear: number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ReviewBonusManager({
  submissions,
  currentMonth,
  currentYear,
}: ReviewBonusManagerProps) {
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingImageTitle, setViewingImageTitle] = useState("");

  const pending = submissions.filter((s) => s.status === "PENDING");
  const approved = submissions.filter((s) => s.status === "APPROVED");
  const rejected = submissions.filter((s) => s.status === "REJECTED");
  const removed = submissions.filter((s) => s.status === "REMOVED");

  async function handleApprove(id: string) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/review-bonus/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVED" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve");
      toast.success("Review bonus approved!");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  function openRejectDialog(id: string) {
    setRejectingId(id);
    setRejectReason("");
    setRejectDialogOpen(true);
  }

  async function handleReject() {
    if (!rejectingId) return;
    if (!rejectReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }

    setActionLoading(rejectingId);
    try {
      const res = await fetch(`/api/review-bonus/${rejectingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECTED", rejectionReason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reject");
      toast.success("Review bonus rejected");
      setRejectDialogOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  function openImageDialog(url: string, title: string) {
    setViewingImage(url);
    setViewingImageTitle(title);
    setImageDialogOpen(true);
  }

  function renderSubmissionCard(sub: Submission, showActions: boolean) {
    const isLoading = actionLoading === sub.id;
    const statusColors: Record<string, string> = {
      PENDING: "bg-amber-50/50 dark:bg-amber-950/15",
      APPROVED: "bg-emerald-50/30 dark:bg-emerald-950/10",
      REJECTED: "bg-rose-50/30 dark:bg-rose-950/10",
      REMOVED: "bg-slate-50/50 dark:bg-slate-800/50",
    };
    const statusBadgeColors: Record<string, string> = {
      PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      REJECTED: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
      REMOVED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    };

    return (
      <Card key={sub.id} className={`border-0 shadow-sm overflow-hidden hover:shadow-md transition-shadow ${showActions ? "ring-1 ring-amber-300 dark:ring-amber-700" : ""}`}>
        <CardContent className="p-0">
          {/* Header */}
          <div className={`px-4 py-3 border-b ${statusColors[sub.status] || ""}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  {sub.user.firstName[0]}{sub.user.lastName?.[0] || ""}
                </div>
                <div>
                  <span className="text-sm font-bold">{sub.user.firstName} {sub.user.lastName}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-muted-foreground font-mono">{sub.user.employeeId}</span>
                    <Badge className={`text-[8px] h-4 border-0 ${statusBadgeColors[sub.status] || ""}`}>{sub.status}</Badge>
                  </div>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="size-7 p-0 text-muted-foreground/40 hover:text-rose-600" onClick={async () => {
                if (!confirm(`Remove this submission${sub.status === "APPROVED" ? " and reverse the incentive" : ""}?`)) return;
                try {
                  const res = await fetch(`/api/review-bonus/${sub.id}`, { method: "DELETE" });
                  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Failed"); }
                  toast.success("Removed"); router.refresh();
                } catch (err: any) { toast.error(err.message); }
              }} disabled={isLoading}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Details */}
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Store</span>
              <span className="font-semibold">{sub.storeName}</span>
            </div>
            {sub.customerName && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium">{sub.customerName}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Submitted</span>
              <span className="font-medium">{format(new Date(sub.createdAt), "MMM d, h:mm a")}</span>
            </div>

            {/* Rating Change */}
            <div className="flex items-center justify-between bg-muted/30 rounded-lg p-2.5">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <Star className="size-4 text-rose-500 fill-rose-500" />
                  <span className="text-sm font-bold text-rose-600">{sub.originalRating}</span>
                </div>
                <span className="text-muted-foreground text-xs">→</span>
                <div className="flex items-center gap-1">
                  <Star className="size-4 text-emerald-500 fill-emerald-500" />
                  <span className="text-sm font-bold text-emerald-600">{sub.newRating}</span>
                </div>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-xs gap-1">
                <DollarSign className="size-3" />PKR {sub.amount.toLocaleString()}
              </Badge>
            </div>

            {/* Screenshots */}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="relative group rounded-lg overflow-hidden border-2 border-rose-200 dark:border-rose-800 cursor-pointer" onClick={() => openImageDialog(sub.beforeScreenshot, "Before Screenshot")}>
                <img src={sub.beforeScreenshot} alt="Before" className="w-full h-28 object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <Eye className="size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded-full font-medium">Before</span>
              </button>
              <button type="button" className="relative group rounded-lg overflow-hidden border-2 border-emerald-200 dark:border-emerald-800 cursor-pointer" onClick={() => openImageDialog(sub.afterScreenshot, "After Screenshot")}>
                <img src={sub.afterScreenshot} alt="After" className="w-full h-28 object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <Eye className="size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-medium">After</span>
              </button>
            </div>

            {sub.status === "REJECTED" && sub.rejectionReason && (
              <div className="text-xs bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 p-2.5 rounded-lg">
                <span className="font-semibold text-rose-700 dark:text-rose-400">Rejection:</span> <span className="text-rose-600 dark:text-rose-400">{sub.rejectionReason}</span>
              </div>
            )}
            {sub.status === "APPROVED" && sub.approvedBy && (
              <p className="text-[10px] text-muted-foreground">Approved by {sub.approvedBy.firstName} {sub.approvedBy.lastName}</p>
            )}
          </div>

          {/* Actions */}
          {showActions && (
            <div className="px-4 py-3 border-t bg-muted/10 flex gap-2">
              <Button size="sm" className="flex-1 h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg" onClick={() => handleApprove(sub.id)} disabled={isLoading}>
                <CheckCircle className="size-3.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-9 gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30 rounded-lg" onClick={() => openRejectDialog(sub.id)} disabled={isLoading}>
                <XCircle className="size-3.5" /> Reject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    router.push(`/review-bonus?month=${m}&year=${y}`);
  }

  const monthName = `${MONTHS[currentMonth - 1]} ${currentYear}`;

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
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 rounded-full">
              <Clock className="size-3 text-amber-600" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{pending.length} pending</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full">
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">PKR {(approved.reduce((s, a) => s + a.amount, 0)).toLocaleString()} paid</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending {pending.length > 0 && `(${pending.length})`}
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved {approved.length > 0 && `(${approved.length})`}
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected {rejected.length > 0 && `(${rejected.length})`}
          </TabsTrigger>
          <TabsTrigger value="removed">
            Removed {removed.length > 0 && `(${removed.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pending.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4 text-center text-muted-foreground py-12">
                No pending submissions.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pending.map((sub) => renderSubmissionCard(sub, true))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="approved">
          {approved.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4 text-center text-muted-foreground py-12">
                No approved submissions.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {approved.map((sub) => renderSubmissionCard(sub, false))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="rejected">
          {rejected.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4 text-center text-muted-foreground py-12">
                No rejected submissions.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rejected.map((sub) => renderSubmissionCard(sub, false))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="removed">
          {removed.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-4 text-center text-muted-foreground py-12">
                No removed submissions.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {removed.map((sub) => renderSubmissionCard(sub, false))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Rejection Reason Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Review Bonus</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Rejection Reason *</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter reason for rejection..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={actionLoading !== null}
            >
              {actionLoading ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Viewer Dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewingImageTitle}</DialogTitle>
          </DialogHeader>
          {viewingImage && (
            <img
              src={viewingImage}
              alt={viewingImageTitle}
              className="w-full rounded-lg object-contain max-h-[70vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
