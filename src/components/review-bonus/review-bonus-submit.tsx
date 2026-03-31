"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Upload, X, Star, Send, DollarSign, Clock, CheckCircle, XCircle, Pencil, Trash2 } from "lucide-react";

interface ReviewSubmission {
  id: string;
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
  createdAt: string;
}

interface ReviewBonusSubmitProps {
  submissions: ReviewSubmission[];
  currentMonth: number;
  currentYear: number;
}

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
};

export function ReviewBonusSubmit({
  submissions,
  currentMonth,
  currentYear,
}: ReviewBonusSubmitProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    storeName: "",
    customerName: "",
    originalRating: "",
    newRating: "",
  });
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);
  const [beforePreview, setBeforePreview] = useState<string | null>(null);
  const [afterPreview, setAfterPreview] = useState<string | null>(null);
  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (type: "before" | "after", file: File | null) => {
      if (!file) return;

      if (type === "before") {
        setBeforeFile(file);
        const url = URL.createObjectURL(file);
        setBeforePreview(url);
      } else {
        setAfterFile(file);
        const url = URL.createObjectURL(file);
        setAfterPreview(url);
      }
    },
    []
  );

  const handleDrop = useCallback(
    (type: "before" | "after") => (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        handleFileSelect(type, file);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const removeFile = (type: "before" | "after") => {
    if (type === "before") {
      setBeforeFile(null);
      if (beforePreview) URL.revokeObjectURL(beforePreview);
      setBeforePreview(null);
    } else {
      setAfterFile(null);
      if (afterPreview) URL.revokeObjectURL(afterPreview);
      setAfterPreview(null);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!editingId && (!beforeFile || !afterFile)) {
      toast.error("Please upload both before and after screenshots");
      return;
    }

    if (!form.originalRating || !form.newRating) {
      toast.error("Please select both original and new ratings");
      return;
    }

    setLoading(true);
    try {
      let beforeUrl = "";
      let afterUrl = "";

      // Upload before screenshot if provided
      if (beforeFile) {
        const beforeFormData = new FormData();
        beforeFormData.append("file", beforeFile);
        const beforeRes = await fetch("/api/upload", { method: "POST", body: beforeFormData });
        const beforeData = await beforeRes.json();
        if (!beforeRes.ok) throw new Error(beforeData.error || "Failed to upload before screenshot");
        beforeUrl = beforeData.url;
      }

      // Upload after screenshot if provided
      if (afterFile) {
        const afterFormData = new FormData();
        afterFormData.append("file", afterFile);
        const afterRes = await fetch("/api/upload", { method: "POST", body: afterFormData });
        const afterData = await afterRes.json();
        if (!afterRes.ok) throw new Error(afterData.error || "Failed to upload after screenshot");
        afterUrl = afterData.url;
      }

      const payload: any = {
        storeName: form.storeName,
        customerName: form.customerName,
        originalRating: parseInt(form.originalRating),
        newRating: parseInt(form.newRating),
      };
      if (beforeUrl) payload.beforeScreenshot = beforeUrl;
      if (afterUrl) payload.afterScreenshot = afterUrl;

      // Edit or create
      const url = editingId ? `/api/review-bonus/${editingId}` : "/api/review-bonus";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");

      toast.success(editingId ? "Submission updated!" : "Review bonus submitted for approval!");
      setForm({ storeName: "", customerName: "", originalRating: "", newRating: "" });
      setEditingId(null);
      removeFile("before");
      removeFile("after");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Bonus Banner */}
      <Card className="border-0 shadow-sm overflow-hidden bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
        <CardContent className="py-5 px-5">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
              <DollarSign className="size-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-emerald-700 dark:text-emerald-400">PKR 500 Per Review Fix</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fix a negative review (1-3 stars) to positive (4-5 stars) and earn PKR 500 bonus per fix
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submission Form */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/20">
          <h3 className="text-xs font-bold">{editingId ? "Edit Submission" : "Submit New Review Fix"}</h3>
        </div>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Store Name</Label>
                <Input
                  value={form.storeName}
                  onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                  placeholder="e.g. META7 Crafts"
                  required
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Customer Name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  placeholder="Customer who left the review"
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Original Rating (Before)</Label>
                <Select
                  value={form.originalRating}
                  onValueChange={(v) => v && setForm({ ...form, originalRating: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Star</SelectItem>
                    <SelectItem value="2">2 Stars</SelectItem>
                    <SelectItem value="3">3 Stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">New Rating (After Fix)</Label>
                <Select
                  value={form.newRating}
                  onValueChange={(v) => v && setForm({ ...form, newRating: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 Stars</SelectItem>
                    <SelectItem value="5">5 Stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Screenshot Uploads */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Before Screenshot */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Before Screenshot</Label>
                <div
                  className="border-2 border-dashed border-rose-200 dark:border-rose-800 rounded-lg p-4 text-center cursor-pointer hover:border-rose-400 transition-colors"
                  onClick={() => beforeInputRef.current?.click()}
                  onDrop={handleDrop("before")}
                  onDragOver={handleDragOver}
                >
                  {beforePreview ? (
                    <div className="relative">
                      <img
                        src={beforePreview}
                        alt="Before screenshot"
                        className="max-h-40 mx-auto rounded object-contain"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile("before");
                        }}
                        className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="py-4">
                      <Upload className="size-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Click or drag to upload before screenshot
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={beforeInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileSelect("before", e.target.files?.[0] || null)}
                />
              </div>

              {/* After Screenshot */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">After Screenshot</Label>
                <div
                  className="border-2 border-dashed border-emerald-200 dark:border-emerald-800 rounded-lg p-4 text-center cursor-pointer hover:border-emerald-400 transition-colors"
                  onClick={() => afterInputRef.current?.click()}
                  onDrop={handleDrop("after")}
                  onDragOver={handleDragOver}
                >
                  {afterPreview ? (
                    <div className="relative">
                      <img
                        src={afterPreview}
                        alt="After screenshot"
                        className="max-h-40 mx-auto rounded object-contain"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile("after");
                        }}
                        className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="py-4">
                      <Upload className="size-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Click or drag to upload after screenshot
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={afterInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileSelect("after", e.target.files?.[0] || null)}
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-10 gap-2 rounded-lg" disabled={loading}>
              <Send className="size-4" />
              {loading ? "Submitting..." : editingId ? "Update Submission" : "Submit for Approval"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Submission History */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold">Your Submissions</h3>
            <Badge variant="outline" className="text-[9px] h-5">{submissions.length} total</Badge>
          </div>
        </div>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Rating Change</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No submissions yet. Submit your first review fix above!
                  </TableCell>
                </TableRow>
              ) : (
                submissions.map((sub) => {
                  const minutesSinceCreated = Math.floor((Date.now() - new Date(sub.createdAt).getTime()) / 60000);
                  const canEdit = sub.status === "PENDING" && minutesSinceCreated <= 2;
                  const timeLeft = canEdit ? Math.max(0, 2 - minutesSinceCreated) : 0;
                  return (
                  <TableRow key={sub.id}>
                    <TableCell className="text-sm font-medium">{sub.storeName}</TableCell>
                    <TableCell className="text-sm">{sub.customerName || "-"}</TableCell>
                    <TableCell className="text-sm">
                      <span className="text-red-500">{sub.originalRating}★</span>
                      {" → "}
                      <span className="text-green-500">{sub.newRating}★</span>
                    </TableCell>
                    <TableCell className="text-sm font-medium text-green-600">
                      Rs. {sub.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusColors[sub.status] || "outline"}>
                        {sub.status}
                      </Badge>
                      {sub.status === "REJECTED" && sub.rejectionReason && (
                        <p className="text-xs text-red-500 mt-1">{sub.rejectionReason}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(sub.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      {canEdit && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{timeLeft}m left</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-500 h-7 px-2"
                            onClick={() => {
                              setForm({
                                storeName: sub.storeName,
                                customerName: sub.customerName || "",
                                originalRating: String(sub.originalRating),
                                newRating: String(sub.newRating),
                              });
                              setEditingId(sub.id);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                              toast.info("Editing submission — update and re-submit");
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 h-7 px-2"
                            onClick={async () => {
                              if (!confirm("Delete this submission?")) return;
                              const res = await fetch(`/api/review-bonus/${sub.id}`, { method: "DELETE" });
                              if (res.ok) {
                                toast.success("Submission deleted");
                                router.refresh();
                              } else {
                                const data = await res.json();
                                toast.error(data.error || "Failed to delete");
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
