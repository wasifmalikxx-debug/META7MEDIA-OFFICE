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
import { Upload, X, Star, Send } from "lucide-react";

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

    if (!beforeFile || !afterFile) {
      toast.error("Please upload both before and after screenshots");
      return;
    }

    if (!form.originalRating || !form.newRating) {
      toast.error("Please select both original and new ratings");
      return;
    }

    setLoading(true);
    try {
      // Upload before screenshot
      const beforeFormData = new FormData();
      beforeFormData.append("file", beforeFile);
      const beforeRes = await fetch("/api/upload", { method: "POST", body: beforeFormData });
      const beforeData = await beforeRes.json();
      if (!beforeRes.ok) throw new Error(beforeData.error || "Failed to upload before screenshot");

      // Upload after screenshot
      const afterFormData = new FormData();
      afterFormData.append("file", afterFile);
      const afterRes = await fetch("/api/upload", { method: "POST", body: afterFormData });
      const afterData = await afterRes.json();
      if (!afterRes.ok) throw new Error(afterData.error || "Failed to upload after screenshot");

      // Submit review bonus with uploaded URLs
      const res = await fetch("/api/review-bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName: form.storeName,
          customerName: form.customerName,
          originalRating: parseInt(form.originalRating),
          newRating: parseInt(form.newRating),
          beforeScreenshot: beforeData.url,
          afterScreenshot: afterData.url,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");

      toast.success("Review bonus submitted for approval!");
      setForm({ storeName: "", customerName: "", originalRating: "", newRating: "" });
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
      {/* Bonus Amount Banner */}
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-green-100">
              <Star className="size-6 text-green-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-green-700">Rs. 500 per Fixed Review</p>
              <p className="text-sm text-green-600">
                Fix a negative review (1-3 stars) to a positive one (4-5 stars) and earn Rs. 500 bonus
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submission Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit Review Fix</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Store Name *</Label>
                <Input
                  value={form.storeName}
                  onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                  placeholder="Enter store name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Customer Name (Optional)</Label>
                <Input
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  placeholder="Enter customer name"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Original Rating *</Label>
                <Select
                  value={form.originalRating}
                  onValueChange={(v) => v && setForm({ ...form, originalRating: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select original rating..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Star</SelectItem>
                    <SelectItem value="2">2 Stars</SelectItem>
                    <SelectItem value="3">3 Stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>New Rating *</Label>
                <Select
                  value={form.newRating}
                  onValueChange={(v) => v && setForm({ ...form, newRating: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select new rating..." />
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
              <div className="space-y-2">
                <Label>Before Screenshot *</Label>
                <div
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
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
              <div className="space-y-2">
                <Label>After Screenshot *</Label>
                <div
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
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

            <Button type="submit" className="w-full" disabled={loading}>
              <Send className="size-4 mr-2" />
              {loading ? "Submitting..." : "Submit Review Bonus"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Submission History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Rating Change</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
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
                submissions.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className="text-sm font-medium">{sub.storeName}</TableCell>
                    <TableCell className="text-sm">{sub.customerName || "-"}</TableCell>
                    <TableCell className="text-sm">
                      <span className="text-red-500">{sub.originalRating}*</span>
                      {" -> "}
                      <span className="text-green-500">{sub.newRating}*</span>
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
