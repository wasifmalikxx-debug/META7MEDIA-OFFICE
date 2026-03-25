"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calculator, CheckCircle, Wallet, ChevronLeft, ChevronRight, Upload, Image as ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PayrollViewProps {
  records: any[];
  isAdmin: boolean;
  currentMonth: number;
  currentYear: number;
}

export function PayrollView({
  records,
  isAdmin,
  currentMonth,
  currentYear,
}: PayrollViewProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: currentMonth, year: currentYear }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Payroll generated for ${data.length} employees`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleUploadProof(id: string, file: File) {
    setUploadingId(id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");

      // Update payroll with proof and mark as paid
      const res = await fetch(`/api/payroll/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID", paymentProof: uploadData.url }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success("Payment proof uploaded & marked as paid");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploadingId(null);
    }
  }

  async function handleStatusUpdate(id: string, status: string) {
    try {
      const res = await fetch(`/api/payroll/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success(`Payroll ${status.toLowerCase()}`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const totalNet = records.reduce((s, r) => s + r.netSalary, 0);
  const totalFines = records.reduce((s, r) => s + r.totalFines, 0);
  const totalIncentives = records.reduce((s, r) => s + r.totalIncentives, 0);
  const monthName = format(new Date(currentYear, currentMonth - 1), "MMMM yyyy");

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    router.push(`/payroll?month=${m}&year=${y}`);
  }

  const isCurrentMonth = currentMonth === new Date().getMonth() + 1 && currentYear === new Date().getFullYear();

  return (
    <div className="space-y-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => goMonth(-1)} className="size-8">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold min-w-[160px] text-center">{monthName}</h2>
          <Button variant="outline" size="icon" onClick={() => goMonth(1)} className="size-8">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {isAdmin && (
          <Button onClick={handleGenerate} disabled={generating} size="sm" className="gap-2">
            <Calculator className="size-4" />
            {generating ? "Generating..." : "Generate Payroll"}
          </Button>
        )}
      </div>

      {isAdmin && records.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span>Total Payable: <strong>PKR {totalNet.toLocaleString()}</strong></span>
          <span className="text-red-600">Fines: PKR {totalFines.toLocaleString()}</span>
          <span className="text-green-600">Bonuses: PKR {totalIncentives.toLocaleString()}</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Salary Sheet — {monthName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Employee</TableHead>
                  <TableHead className="whitespace-nowrap">Payment</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Salary</TableHead>
                  <TableHead className="whitespace-nowrap text-center">Absents</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Absent Fine</TableHead>
                  <TableHead className="whitespace-nowrap text-right">After Fine</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Extra Bonus</TableHead>
                  <TableHead className="whitespace-nowrap text-right font-bold">Final Salary</TableHead>
                  <TableHead className="whitespace-nowrap">Account Details</TableHead>
                  {isAdmin && <TableHead>Actions</TableHead>}
                  {!isAdmin && <TableHead>Proof</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isAdmin ? 10 : 9}
                      className="text-center text-muted-foreground"
                    >
                      No payroll records. {isAdmin && "Click 'Generate Payroll' to start."}
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((rec) => {
                    const absentFine = rec.totalDeductions - rec.totalFines;
                    const afterFine = rec.monthlySalary - (absentFine > 0 ? absentFine : 0);
                    return (
                      <TableRow key={rec.id}>
                        <TableCell className="whitespace-nowrap">
                          <div>
                            <span className="text-sm font-medium">
                              {rec.user.firstName} {rec.user.lastName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-xs ${
                              rec.status === "PAID"
                                ? "bg-green-100 text-green-700 hover:bg-green-100"
                                : "bg-amber-100 text-amber-700 hover:bg-amber-100"
                            }`}
                          >
                            {rec.status === "PAID" ? "Paid" : "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          Rs{rec.monthlySalary.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {rec.absentDays}
                        </TableCell>
                        <TableCell className="text-right text-sm text-red-600">
                          {absentFine > 0 ? `Rs${Math.round(absentFine).toLocaleString()}` : "Rs0"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          Rs{Math.round(afterFine > 0 ? afterFine : rec.earnedSalary).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm text-green-600">
                          {rec.totalIncentives > 0
                            ? `Rs${rec.totalIncentives.toLocaleString()}`
                            : "Rs0"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-bold">
                          Rs{rec.netSalary.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {rec.user.bankName
                            ? `${rec.user.bankName} | ${rec.user.accountNumber || ""} | ${rec.user.accountTitle || ""}`
                            : "—"}
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            <div className="flex gap-1 items-center" onClick={(e) => e.stopPropagation()}>
                              {(rec.status === "DRAFT" || rec.status === "CALCULATED" || rec.status === "APPROVED") && (
                                <>
                                  <Button
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700 text-white gap-1"
                                    onClick={() => handleStatusUpdate(rec.id, "PAID")}
                                  >
                                    <Wallet className="size-3" /> Mark Paid
                                  </Button>
                                  <label className="cursor-pointer">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleUploadProof(rec.id, file);
                                        e.target.value = "";
                                      }}
                                    />
                                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded-md hover:bg-muted cursor-pointer">
                                      <Upload className="size-3" />
                                      {uploadingId === rec.id ? "..." : "Proof"}
                                    </span>
                                  </label>
                                </>
                              )}
                              {rec.status === "PAID" && (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                    <CheckCircle className="size-3" /> Paid
                                  </span>
                                  {rec.paymentProof && (
                                    <Button size="sm" variant="ghost" className="size-6 p-0" onClick={() => setProofPreview(rec.paymentProof)}>
                                      <ImageIcon className="size-3 text-blue-500" />
                                    </Button>
                                  )}
                                  {!rec.paymentProof && (
                                    <label className="cursor-pointer">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          setUploadingId(rec.id);
                                          try {
                                            const fd = new FormData();
                                            fd.append("file", file);
                                            const up = await fetch("/api/upload", { method: "POST", body: fd });
                                            const upData = await up.json();
                                            if (!up.ok) throw new Error(upData.error);
                                            await fetch(`/api/payroll/${rec.id}`, {
                                              method: "PATCH",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ status: "PAID", paymentProof: upData.url }),
                                            });
                                            toast.success("Proof uploaded");
                                            router.refresh();
                                          } catch (err: any) { toast.error(err.message); }
                                          finally { setUploadingId(null); }
                                          e.target.value = "";
                                        }}
                                      />
                                      <span className="text-xs text-blue-500 cursor-pointer hover:underline">+ Add Proof</span>
                                    </label>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {/* Employee: show proof if available */}
                        {!isAdmin && rec.paymentProof && (
                          <TableCell>
                            <Button size="sm" variant="ghost" className="gap-1 text-blue-500" onClick={() => setProofPreview(rec.paymentProof)}>
                              <ImageIcon className="size-3" /> View Proof
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {/* Payment Proof Preview Dialog */}
      <Dialog open={!!proofPreview} onOpenChange={() => setProofPreview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment Proof</DialogTitle>
          </DialogHeader>
          {proofPreview && (
            <img src={proofPreview} alt="Payment proof" className="w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
