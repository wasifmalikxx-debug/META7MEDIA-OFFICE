"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  ShoppingBag,
  User as UserIcon,
  DollarSign,
  Package,
  TrendingDown,
  RefreshCcw,
  Trash2,
  Send,
  CheckCircle2,
  XCircle,
  StickyNote,
  Users,
  Pencil,
  Paperclip,
  Loader2,
  Image as ImageIcon,
  X,
  ShieldCheck,
} from "lucide-react";
import { formatPKTDisplay, formatPKTTime } from "@/lib/pkt";

interface Refund {
  id: string;
  userId: string;
  storeName: string;
  customerName: string;
  etsyRefundAmount: number;
  aliexpressRefunded: boolean;
  aliexpressAmount: number | null;
  aliexpressProofUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  user: { firstName: string; lastName: string | null; employeeId: string };
}

/**
 * Compress an image to a small JPEG data URL.
 * Max 1600px longest side, 0.82 quality → typically 100–400 KB.
 * Keeps JSON payloads under the Next.js body limit.
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
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

interface RefundsViewProps {
  initialRefunds: Refund[];
  canSeeAll: boolean;
  canSubmit: boolean;
  currentUserId: string;
  currentMonth: number;
  currentYear: number;
}

export function RefundsView({
  initialRefunds,
  canSeeAll,
  canSubmit,
  currentUserId,
  currentMonth,
  currentYear,
}: RefundsViewProps) {
  const router = useRouter();
  const [refunds, setRefunds] = useState<Refund[]>(initialRefunds);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [proofImage, setProofImage] = useState<string | null>(null); // new upload (data URL)
  const [keepExistingProof, setKeepExistingProof] = useState(false); // true when editing and not replacing
  const [uploadingProof, setUploadingProof] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const proofFileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    storeName: "",
    customerName: "",
    etsyRefundAmount: "",
    aliexpressRefunded: false,
    aliexpressAmount: "",
    notes: "",
  });

  function resetForm() {
    setForm({
      storeName: "",
      customerName: "",
      etsyRefundAmount: "",
      aliexpressRefunded: false,
      aliexpressAmount: "",
      notes: "",
    });
    setEditingId(null);
    setProofImage(null);
    setKeepExistingProof(false);
  }

  function openEditDialog(r: Refund) {
    setEditingId(r.id);
    setForm({
      storeName: r.storeName,
      customerName: r.customerName,
      etsyRefundAmount: String(r.etsyRefundAmount),
      aliexpressRefunded: r.aliexpressRefunded,
      aliexpressAmount: r.aliexpressAmount != null ? String(r.aliexpressAmount) : "",
      notes: r.notes || "",
    });
    // When editing, if the refund already has a proof image, show the existing
    // one as a preview and mark "keepExistingProof" so the server knows to reuse
    // it when no new file is uploaded
    if (r.aliexpressProofUrl) {
      setProofImage(r.aliexpressProofUrl);
      setKeepExistingProof(true);
    } else {
      setProofImage(null);
      setKeepExistingProof(false);
    }
    setOpen(true);
  }

  async function handleProofPick(e: React.ChangeEvent<HTMLInputElement>) {
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
    setUploadingProof(true);
    try {
      const compressed = await compressImage(file);
      setProofImage(compressed);
      setKeepExistingProof(false); // a new image replaces the existing one
    } catch (err: any) {
      toast.error(err.message || "Failed to process image");
    } finally {
      setUploadingProof(false);
      if (proofFileInputRef.current) proofFileInputRef.current.value = "";
    }
  }

  const monthName = formatPKTDisplay(
    new Date(Date.UTC(currentYear, currentMonth - 1, 1)),
    "MMMM yyyy"
  );

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    router.push(`/refunds?month=${m}&year=${y}`);
  }

  // Aggregated stats for the current view
  const stats = useMemo(() => {
    const totalCount = refunds.length;
    const totalEtsy = refunds.reduce((s, r) => s + (r.etsyRefundAmount || 0), 0);
    const totalAliexpress = refunds.reduce((s, r) => s + (r.aliexpressAmount || 0), 0);
    const netLoss = totalEtsy - totalAliexpress;
    const aliCovered = refunds.filter((r) => r.aliexpressRefunded).length;
    const uniqueEmployees = new Set(refunds.map((r) => r.user.employeeId)).size;
    return { totalCount, totalEtsy, totalAliexpress, netLoss, aliCovered, uniqueEmployees };
  }, [refunds]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.storeName.trim()) { toast.error("Store name is required"); return; }
    if (!form.customerName.trim()) { toast.error("Customer name is required"); return; }
    const etsyAmt = parseFloat(form.etsyRefundAmount);
    if (isNaN(etsyAmt) || etsyAmt <= 0) { toast.error("Enter a valid Etsy refund amount"); return; }
    if (form.aliexpressRefunded) {
      const aliAmt = parseFloat(form.aliexpressAmount);
      if (isNaN(aliAmt) || aliAmt <= 0) { toast.error("Enter a valid AliExpress refund amount"); return; }
      // Proof required: either a new upload or an existing one being kept
      if (!proofImage && !keepExistingProof) {
        toast.error("Screenshot proof is required when AliExpress refund is Yes");
        return;
      }
    } else {
      // When AliExpress refund is NOT applied, the employee must explain why.
      // Notes becomes mandatory in this case.
      if (!form.notes.trim() || form.notes.trim().length < 10) {
        toast.error("Please explain why the refund was not applied on AliExpress (min 10 characters)");
        return;
      }
    }

    setLoading(true);
    try {
      const payload: any = {
        storeName: form.storeName.trim(),
        customerName: form.customerName.trim(),
        etsyRefundAmount: etsyAmt,
        aliexpressRefunded: form.aliexpressRefunded,
        notes: form.notes.trim() || null,
      };
      if (form.aliexpressRefunded) {
        payload.aliexpressAmount = parseFloat(form.aliexpressAmount);
        if (proofImage && !keepExistingProof) {
          // New upload (data URL starts with data:image/)
          payload.aliexpressProofUrl = proofImage;
        } else if (keepExistingProof) {
          // Editing and reusing the existing stored proof
          payload.keepExistingProof = true;
        }
      }

      const isEdit = !!editingId;
      const url = isEdit ? `/api/refunds/${editingId}` : "/api/refunds";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");

      toast.success(isEdit ? "Refund updated" : "Refund submitted");
      if (isEdit) {
        setRefunds(refunds.map((r) => (r.id === data.id ? data : r)));
      } else {
        setRefunds([data, ...refunds]);
      }
      resetForm();
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this refund? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/refunds/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      toast.success("Refund deleted");
      setRefunds(refunds.filter((r) => r.id !== id));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  // Group refunds by date — most recent first. Used for both employee and admin views.
  // Date key is the PKT date string (YYYY-MM-DD) derived from createdAt.
  const groupedByDate = useMemo(() => {
    const groups: Record<string, Refund[]> = {};
    for (const r of refunds) {
      // createdAt is stored as PKT-shifted, so getUTCFullYear/Month/Date gives PKT date
      const d = new Date(r.createdAt);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const key = `${y}-${m}-${day}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    // Sort dates most-recent first, refunds within each date also most-recent first
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, items]) => ({
        dateKey,
        dateObj: new Date(dateKey + "T00:00:00Z"),
        items: items.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
      }));
  }, [refunds]);

  return (
    <div className="space-y-6">
      {/* KPI cards — only visible to CEO and team lead (Izaan). Regular
          employees don't need aggregate totals of their own refunds. */}
      {canSeeAll && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <RefreshCcw className="size-3.5 text-blue-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Refunds
                </p>
              </div>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.totalCount}</p>
              {stats.uniqueEmployees > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  from {stats.uniqueEmployees} employee{stats.uniqueEmployees !== 1 ? "s" : ""}
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="size-3.5 text-rose-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Etsy Refunded
                </p>
              </div>
              <p className="text-3xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                ${stats.totalEtsy.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Package className="size-3.5 text-emerald-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  AliExpress Recovered
                </p>
              </div>
              <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                ${stats.totalAliexpress.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {stats.aliCovered} of {stats.totalCount} covered
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="size-3.5 text-amber-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Net Loss
                </p>
              </div>
              <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                ${stats.netLoss.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Etsy − AliExpress</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Month nav + submit button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(-1)}
            className="size-9 rounded-full"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-[200px] justify-center">
            <CalendarIcon className="size-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">{monthName}</h2>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(1)}
            className="size-9 rounded-full"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {canSubmit && (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) resetForm();
            }}
          >
            <DialogTrigger
              render={
                <Button className="gap-2 rounded-lg" onClick={resetForm}>
                  <Plus className="size-4" />
                  Submit Refund
                </Button>
              }
            />
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <RefreshCcw className="size-5 text-rose-600" />
                  {editingId ? "Edit Refund" : "Submit Refund"}
                </DialogTitle>
                <DialogDescription>
                  {editingId
                    ? "Make changes to this refund. You can edit within 15 minutes of submission."
                    : "Log a refund for your assigned Etsy shop. Visible to CEO and Team Lead."}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Store Name</Label>
                    <Input
                      value={form.storeName}
                      onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                      placeholder="e.g. MidnightCraftCo"
                      className="h-9"
                      maxLength={80}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Customer Name</Label>
                    <Input
                      value={form.customerName}
                      onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                      placeholder="e.g. Jane Smith"
                      className="h-9"
                      maxLength={80}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Etsy Order Refunded Amount (USD)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.etsyRefundAmount}
                      onChange={(e) => setForm({ ...form, etsyRefundAmount: e.target.value })}
                      placeholder="0.00"
                      className="h-9 pl-7 tabular-nums"
                      required
                    />
                  </div>
                </div>

                {/* AliExpress toggle */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">
                    Was the refund also applied on AliExpress?
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={form.aliexpressRefunded ? "default" : "outline"}
                      className="flex-1 h-9 gap-1.5"
                      onClick={() => setForm({ ...form, aliexpressRefunded: true })}
                    >
                      <CheckCircle2 className="size-3.5" />
                      Yes
                    </Button>
                    <Button
                      type="button"
                      variant={!form.aliexpressRefunded ? "default" : "outline"}
                      className="flex-1 h-9 gap-1.5"
                      onClick={() => {
                        setForm({ ...form, aliexpressRefunded: false, aliexpressAmount: "" });
                        // Clear any uploaded/kept proof when switching to No
                        setProofImage(null);
                        setKeepExistingProof(false);
                      }}
                    >
                      <XCircle className="size-3.5" />
                      No
                    </Button>
                  </div>
                </div>

                {form.aliexpressRefunded && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">AliExpress Refund Amount (USD)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                          $
                        </span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.aliexpressAmount}
                          onChange={(e) => setForm({ ...form, aliexpressAmount: e.target.value })}
                          placeholder="0.00"
                          className="h-9 pl-7 tabular-nums"
                          required
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        How much did you recover from AliExpress for this order?
                      </p>
                    </div>

                    {/* Screenshot proof — REQUIRED when Yes is selected */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold flex items-center gap-1.5">
                        <ImageIcon className="size-3.5" />
                        Screenshot Proof
                        <span className="text-rose-500">*</span>
                      </Label>
                      <input
                        ref={proofFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleProofPick}
                      />
                      {proofImage ? (
                        <div className="relative inline-block">
                          <img
                            src={proofImage}
                            alt="AliExpress refund proof"
                            className="h-36 w-auto rounded-lg border object-cover cursor-pointer"
                            onClick={() => setLightboxImage(proofImage)}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setProofImage(null);
                              setKeepExistingProof(false);
                            }}
                            className="absolute -top-2 -right-2 size-6 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 shadow-md"
                            title="Remove image"
                          >
                            <X className="size-3.5" />
                          </button>
                          {keepExistingProof && (
                            <p className="text-[9px] text-muted-foreground mt-1">
                              Current proof. Click to preview, × to replace.
                            </p>
                          )}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full h-20 border-dashed gap-2 flex-col text-muted-foreground hover:text-rose-600 hover:border-rose-400"
                          onClick={() => proofFileInputRef.current?.click()}
                          disabled={uploadingProof}
                        >
                          {uploadingProof ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              <span className="text-[10px]">Processing...</span>
                            </>
                          ) : (
                            <>
                              <Paperclip className="size-4" />
                              <span className="text-[10px]">Click to upload AliExpress refund screenshot</span>
                            </>
                          )}
                        </Button>
                      )}
                      <p className="text-[10px] text-rose-600 dark:text-rose-400">
                        Required. Upload a screenshot of the AliExpress refund confirmation.
                      </p>
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  {form.aliexpressRefunded ? (
                    <>
                      <Label className="text-xs font-semibold">
                        Notes <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Textarea
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Reason, order details, or anything to flag..."
                        rows={3}
                        className="resize-none text-xs"
                        maxLength={1000}
                      />
                    </>
                  ) : (
                    <>
                      <Label className="text-xs font-semibold flex items-center gap-1">
                        Please explain everything — why the refund is NOT applied on AliExpress
                        <span className="text-rose-500">*</span>
                      </Label>
                      <Textarea
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Explain in detail why this refund was not applied on AliExpress. Include the order details, reason, and any steps you took..."
                        rows={5}
                        className="resize-none text-xs"
                        maxLength={1000}
                        required
                      />
                      <p className="text-[10px] text-rose-600 dark:text-rose-400">
                        Required. Provide a clear reason so CEO and Team Lead can review why AliExpress was not charged back.
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button type="button" variant="ghost" onClick={() => { setOpen(false); resetForm(); }}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      loading ||
                      uploadingProof ||
                      // Yes path: must have proof attached
                      (form.aliexpressRefunded && !proofImage && !keepExistingProof) ||
                      // No path: must have an explanation (min 10 chars)
                      (!form.aliexpressRefunded && form.notes.trim().length < 10)
                    }
                    className="gap-2"
                  >
                    <Send className="size-4" />
                    {loading ? "Saving..." : editingId ? "Save Changes" : "Submit Refund"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Refund list — organized by date (most recent first) */}
      {refunds.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 mx-auto rounded-2xl bg-gradient-to-br from-rose-100 to-amber-100 dark:from-rose-950/50 dark:to-amber-950/50 flex items-center justify-center mb-3">
              <RefreshCcw className="size-7 text-rose-500" />
            </div>
            <p className="text-sm font-semibold">No refunds for {monthName}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {canSubmit
                ? 'Click "Submit Refund" to log your first refund.'
                : "Refunds submitted by the Etsy team will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {groupedByDate.map(({ dateKey, dateObj, items }) => {
            const dayEtsy = items.reduce((s, r) => s + r.etsyRefundAmount, 0);
            const dayAli = items.reduce((s, r) => s + (r.aliexpressAmount || 0), 0);
            const dayNet = dayEtsy - dayAli;
            const uniqueShops = new Set(items.map((r) => r.storeName)).size;
            return (
              <div key={dateKey} className="space-y-2.5">
                {/* Date section header */}
                <div className="flex items-center gap-3 sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-1 px-1 border-b">
                  <div className="size-9 rounded-lg bg-gradient-to-br from-rose-100 to-amber-100 dark:from-rose-950/40 dark:to-amber-950/40 flex items-center justify-center shrink-0">
                    <CalendarIcon className="size-4 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h2 className="text-sm font-bold">
                        {formatPKTDisplay(dateObj, "EEEE, MMMM d, yyyy")}
                      </h2>
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-bold">
                        {items.length} refund{items.length !== 1 ? "s" : ""}
                      </Badge>
                      {canSeeAll && uniqueShops > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          · {uniqueShops} shop{uniqueShops !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] mt-0.5 tabular-nums">
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">
                        −${dayEtsy.toFixed(2)} Etsy
                      </span>
                      {dayAli > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          +${dayAli.toFixed(2)} AliExpress
                        </span>
                      )}
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        = ${dayNet.toFixed(2)} net
                      </span>
                    </div>
                  </div>
                </div>
                {/* Refunds for this date */}
                <div className="grid gap-2">
                  {items.map((r) => (
                    <RefundCard
                      key={r.id}
                      refund={r}
                      currentUserId={currentUserId}
                      canSeeAll={canSeeAll}
                      onEdit={() => openEditDialog(r)}
                      onDelete={() => handleDelete(r.id)}
                      onViewProof={(url) => setLightboxImage(url)}
                      showEmployee={canSeeAll}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fullscreen lightbox for viewing proof screenshots */}
      <Dialog open={!!lightboxImage} onOpenChange={(o) => !o && setLightboxImage(null)}>
        <DialogContent
          className="p-0 bg-black/95 border-0 flex items-center justify-center"
          style={{ width: "98vw", maxWidth: "98vw", height: "96vh", maxHeight: "96vh" }}
        >
          <DialogTitle className="sr-only">AliExpress refund proof</DialogTitle>
          {lightboxImage && (
            <img
              src={lightboxImage}
              alt="AliExpress refund proof"
              className="max-w-full max-h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RefundCard({
  refund: r,
  currentUserId,
  canSeeAll,
  onEdit,
  onDelete,
  onViewProof,
  showEmployee,
}: {
  refund: Refund;
  currentUserId: string;
  canSeeAll: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onViewProof: (url: string) => void;
  showEmployee: boolean;
}) {
  const netLoss = r.etsyRefundAmount - (r.aliexpressAmount || 0);
  const isOwner = r.userId === currentUserId;

  // 15-minute edit/delete window for the owner. createdAt is PKT-shifted,
  // so compare against (Date.now() + 5h) to stay in the same time space.
  const minutesSince = Math.floor(
    (Date.now() + 5 * 60 * 60_000 - new Date(r.createdAt).getTime()) / 60000
  );
  const withinWindow = minutesSince <= 15;
  const minutesLeft = Math.max(0, 15 - minutesSince);

  // Edit is ONLY allowed by the original submitter within the 15-minute window.
  // CEO / Izaan cannot edit — they can only delete. This keeps refund records
  // authoritative to the employee who submitted them.
  const canEdit = isOwner && withinWindow;
  const canDelete = canSeeAll || (isOwner && withinWindow);

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-all">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <ShoppingBag className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold">{r.storeName}</span>
              </div>
              <span className="text-muted-foreground/50 text-[10px]">·</span>
              <div className="flex items-center gap-1.5">
                <UserIcon className="size-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{r.customerName}</span>
              </div>
              {showEmployee && (
                <>
                  <span className="text-muted-foreground/50 text-[10px]">·</span>
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    {r.user.firstName} {r.user.lastName}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">
                    {r.user.employeeId}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="text-[10px] h-5 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-0 gap-1 tabular-nums">
                <TrendingDown className="size-2.5" />
                Etsy ${r.etsyRefundAmount.toFixed(2)}
              </Badge>
              {r.aliexpressRefunded && r.aliexpressAmount != null ? (
                <>
                  <Badge className="text-[10px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 gap-1 tabular-nums">
                    <Package className="size-2.5" />
                    AliExpress ${r.aliexpressAmount.toFixed(2)}
                  </Badge>
                  {r.aliexpressProofUrl && (
                    <button
                      type="button"
                      onClick={() => onViewProof(r.aliexpressProofUrl!)}
                      className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
                      title="View proof screenshot"
                    >
                      <ShieldCheck className="size-2.5" />
                      Proof
                    </button>
                  )}
                </>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 gap-1 text-muted-foreground">
                  <XCircle className="size-2.5" />
                  Not on AliExpress
                </Badge>
              )}
              <Badge
                className={`text-[10px] h-5 border-0 gap-1 tabular-nums ${
                  netLoss > 0
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                Net ${netLoss.toFixed(2)}
              </Badge>
            </div>

            {r.notes && (
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground mt-1">
                <StickyNote className="size-3 text-amber-500 shrink-0 mt-0.5" />
                <p className="whitespace-pre-wrap leading-relaxed">{r.notes}</p>
              </div>
            )}

            <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-0.5">
              <span className="flex items-center gap-1">
                <CalendarIcon className="size-3" />
                {formatPKTTime(new Date(r.createdAt))}
              </span>
              {isOwner && withinWindow && !canSeeAll && (
                <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400 font-medium">
                  Editable for {minutesLeft}m more
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="size-8 p-0 text-muted-foreground hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                onClick={onEdit}
                title="Edit refund"
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="size-8 p-0 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                onClick={onDelete}
                title="Delete refund"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
