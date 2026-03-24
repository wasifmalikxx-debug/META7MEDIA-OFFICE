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
import { Check, X, Eye, Star } from "lucide-react";

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

  async function handleApprove(id: string) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/review-bonus/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
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
        body: JSON.stringify({ action: "reject", rejectionReason: rejectReason }),
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

    return (
      <Card key={sub.id} className="overflow-hidden">
        <CardContent className="pt-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-sm">
                  {sub.user.firstName} {sub.user.lastName}
                  <span className="text-muted-foreground ml-2 text-xs">{sub.user.employeeId}</span>
                </p>
                <p className="text-sm text-muted-foreground">{sub.storeName}</p>
                {sub.customerName && (
                  <p className="text-xs text-muted-foreground">Customer: {sub.customerName}</p>
                )}
              </div>
              <div className="text-right">
                <Badge
                  variant={
                    sub.status === "APPROVED" ? "default" :
                    sub.status === "REJECTED" ? "destructive" : "outline"
                  }
                >
                  {sub.status}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(sub.createdAt), "MMM d, yyyy")}
                </p>
              </div>
            </div>

            {/* Rating Change */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-red-500">
                <Star className="size-4 fill-current" />
                <span className="font-medium">{sub.originalRating}</span>
              </div>
              <span className="text-muted-foreground">-&gt;</span>
              <div className="flex items-center gap-1 text-green-500">
                <Star className="size-4 fill-current" />
                <span className="font-medium">{sub.newRating}</span>
              </div>
              <span className="ml-auto font-bold text-green-600">Rs. {sub.amount.toLocaleString()}</span>
            </div>

            {/* Screenshots */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="relative group rounded-lg overflow-hidden border cursor-pointer"
                onClick={() => openImageDialog(sub.beforeScreenshot, "Before Screenshot")}
              >
                <img
                  src={sub.beforeScreenshot}
                  alt="Before"
                  className="w-full h-24 object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <Eye className="size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
                  Before
                </span>
              </button>
              <button
                type="button"
                className="relative group rounded-lg overflow-hidden border cursor-pointer"
                onClick={() => openImageDialog(sub.afterScreenshot, "After Screenshot")}
              >
                <img
                  src={sub.afterScreenshot}
                  alt="After"
                  className="w-full h-24 object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <Eye className="size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
                  After
                </span>
              </button>
            </div>

            {/* Rejection reason */}
            {sub.status === "REJECTED" && sub.rejectionReason && (
              <div className="text-sm text-red-500 bg-red-50 p-2 rounded">
                <span className="font-medium">Reason:</span> {sub.rejectionReason}
              </div>
            )}

            {/* Approved by */}
            {sub.status === "APPROVED" && sub.approvedBy && (
              <p className="text-xs text-muted-foreground">
                Approved by {sub.approvedBy.firstName} {sub.approvedBy.lastName}
              </p>
            )}

            {/* Actions */}
            {showActions && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleApprove(sub.id)}
                  disabled={isLoading}
                >
                  <Check className="size-3.5 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => openRejectDialog(sub.id)}
                  disabled={isLoading}
                >
                  <X className="size-3.5 mr-1" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Showing submissions for {MONTHS[currentMonth - 1]} {currentYear}
      </p>

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
        </TabsList>

        <TabsContent value="pending">
          {pending.length === 0 ? (
            <Card>
              <CardContent className="pt-4 text-center text-muted-foreground py-8">
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
            <Card>
              <CardContent className="pt-4 text-center text-muted-foreground py-8">
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
            <Card>
              <CardContent className="pt-4 text-center text-muted-foreground py-8">
                No rejected submissions.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rejected.map((sub) => renderSubmissionCard(sub, false))}
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
