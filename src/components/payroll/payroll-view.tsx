"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Calculator, CheckCircle, Wallet, ChevronLeft, ChevronRight, Upload, Image as ImageIcon } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface PayrollViewProps {
  records: any[];
  isAdmin: boolean;
  currentMonth: number;
  currentYear: number;
}

export function PayrollView({ records, isAdmin, currentMonth, currentYear }: PayrollViewProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  const monthName = format(new Date(currentYear, currentMonth - 1), "MMMM yyyy");
  const totalNet = records.reduce((s: number, r: any) => s + r.netSalary, 0);
  const totalFines = records.reduce((s: number, r: any) => s + r.totalFines, 0);
  const totalIncentives = records.reduce((s: number, r: any) => s + r.totalIncentives, 0);

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    router.push(`/payroll?month=${m}&year=${y}`);
  }

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

  async function handleStatusUpdate(id: string, status: string) {
    try {
      const res = await fetch(`/api/payroll/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const text = await res.text();
        try { throw new Error(JSON.parse(text).error); } catch { throw new Error(text || "Failed"); }
      }
      toast.success(status === "PAID" ? "Marked as paid" : "Marked as pending");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleUploadProof(id: string, file: File) {
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData.error || "Upload failed");
      const res = await fetch(`/api/payroll/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID", paymentProof: upData.url }),
      });
      if (!res.ok) throw new Error("Failed to save proof");
      toast.success("Proof uploaded & marked as paid");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploadingId(null);
    }
  }

  // Group records by department
  const grouped: Record<string, any[]> = {};
  records.forEach((rec: any) => {
    const dept = rec.user.department?.name || "Other";
    if (!grouped[dept]) grouped[dept] = [];
    grouped[dept].push(rec);
  });
  const deptOrder = Object.keys(grouped).sort((a, b) => {
    if (a === "Etsy") return -1;
    if (b === "Etsy") return 1;
    return a.localeCompare(b);
  });

  function renderTable(deptRecords: any[], deptName: string) {
    const deptTotal = deptRecords.reduce((s: number, r: any) => s + r.netSalary, 0);
    return (
      <Card key={deptName} className="overflow-hidden">
        <CardHeader className="pb-2 bg-muted/30">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">{deptName} Team</CardTitle>
            <span className="text-xs text-muted-foreground">{deptRecords.length} employees</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-xs font-semibold py-2">Employee</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-center">Status</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">Salary</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-center">Absents</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">Fine</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">After Fine</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">Bonus</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">Final Salary</TableHead>
                <TableHead className="text-xs font-semibold py-2">Account</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-center">Proof</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-center">Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deptRecords.map((rec: any) => {
                const absentDeduction = Math.round(rec.monthlySalary / 30) * rec.absentDays;
                const afterFine = rec.monthlySalary - absentDeduction - rec.totalFines;
                return (
                  <TableRow key={rec.id} className="hover:bg-muted/10">
                    {/* Employee */}
                    <TableCell className="py-2.5">
                      <div className="text-sm font-medium">{rec.user.firstName} {rec.user.lastName}</div>
                      <div className="text-xs text-muted-foreground">{rec.user.employeeId}</div>
                    </TableCell>
                    {/* HIRED/PROBATION Status */}
                    <TableCell className="text-center py-2.5">
                      <Badge className={`text-[10px] px-1.5 ${rec.user.status === "HIRED" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}`}>
                        {rec.user.status}
                      </Badge>
                    </TableCell>
                    {/* Salary */}
                    <TableCell className="text-right text-sm py-2.5">
                      Rs{rec.monthlySalary.toLocaleString()}
                    </TableCell>
                    {/* Absents */}
                    <TableCell className="text-center text-sm py-2.5">
                      {rec.absentDays > 0 ? (
                        <span className="text-red-600 font-medium">{rec.absentDays}</span>
                      ) : (
                        <span className="text-green-600">0</span>
                      )}
                    </TableCell>
                    {/* Fine */}
                    <TableCell className="text-right text-sm py-2.5">
                      {rec.totalDeductions > 0 ? (
                        <span className="text-red-600">Rs{Math.round(rec.totalDeductions).toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">Rs0</span>
                      )}
                    </TableCell>
                    {/* After Fine */}
                    <TableCell className="text-right text-sm py-2.5">
                      Rs{Math.round(rec.monthlySalary - rec.totalDeductions).toLocaleString()}
                    </TableCell>
                    {/* Bonus */}
                    <TableCell className="text-right text-sm py-2.5">
                      {rec.totalIncentives > 0 ? (
                        <span className="text-green-600 font-medium">Rs{rec.totalIncentives.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">Rs0</span>
                      )}
                    </TableCell>
                    {/* Final Salary */}
                    <TableCell className="text-right py-2.5">
                      <span className="text-sm font-bold">Rs{rec.netSalary.toLocaleString()}</span>
                    </TableCell>
                    {/* Account Details */}
                    <TableCell className="py-2.5">
                      {rec.user.bankName ? (
                        <div className="max-w-[180px]">
                          <div className="text-xs font-medium truncate">{rec.user.bankName}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{rec.user.accountNumber}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{rec.user.accountTitle}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not provided</span>
                      )}
                    </TableCell>
                    {/* Proof */}
                    <TableCell className="text-center py-2.5">
                      {rec.paymentProof ? (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-blue-600 gap-1" onClick={() => setProofPreview(rec.paymentProof)}>
                          <ImageIcon className="size-3" /> View
                        </Button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                      {isAdmin && rec.status === "PAID" && (
                        <label className="cursor-pointer block mt-0.5">
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadProof(rec.id, f); e.target.value = ""; }} />
                          <span className="text-[10px] text-blue-500 hover:underline">{uploadingId === rec.id ? "..." : (rec.paymentProof ? "Update" : "+ Add")}</span>
                        </label>
                      )}
                    </TableCell>
                    {/* Payment */}
                    <TableCell className="text-center py-2.5">
                      {isAdmin ? (
                        <div className="flex flex-col items-center gap-1">
                          {rec.status !== "PAID" ? (
                            <Button size="sm" className="h-7 px-3 bg-green-600 hover:bg-green-700 text-white text-xs gap-1" onClick={() => handleStatusUpdate(rec.id, "PAID")}>
                              <Wallet className="size-3" /> Paid
                            </Button>
                          ) : (
                            <>
                              <span className="text-xs text-green-600 font-medium flex items-center gap-0.5">
                                <CheckCircle className="size-3" /> Paid
                              </span>
                              <button className="text-[10px] text-red-400 hover:text-red-600 hover:underline" onClick={() => handleStatusUpdate(rec.id, "DRAFT")}>
                                Undo
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <Badge className={`text-xs ${rec.status === "PAID" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}`}>
                          {rec.status === "PAID" ? "Paid" : "Pending"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Department Total Row */}
              <TableRow className="bg-muted/20 border-t-2">
                <TableCell colSpan={7} className="text-right text-xs font-semibold py-2">
                  {deptName} Total:
                </TableCell>
                <TableCell className="text-right py-2">
                  <span className="text-sm font-bold">Rs{deptTotal.toLocaleString()}</span>
                </TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => goMonth(-1)} className="size-8">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="text-lg font-bold min-w-[180px] text-center">{monthName}</h2>
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

      {/* Summary Strip */}
      {records.length > 0 && (
        <div className="flex gap-6 text-sm bg-muted/30 rounded-lg px-4 py-2.5">
          <div>Total Payable: <span className="font-bold">PKR {totalNet.toLocaleString()}</span></div>
          <div className="text-red-600">Fines: PKR {totalFines.toLocaleString()}</div>
          <div className="text-green-600">Bonuses: PKR {totalIncentives.toLocaleString()}</div>
          <div className="ml-auto text-muted-foreground">{records.length} employees</div>
        </div>
      )}

      {/* Department Tables */}
      {deptOrder.map((dept) => renderTable(grouped[dept], dept))}

      {records.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No payroll records for {monthName}.{isAdmin && " Click 'Generate Payroll' to calculate salaries."}
          </CardContent>
        </Card>
      )}

      {/* Proof Preview Dialog */}
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
