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
import { Calculator, CheckCircle, Wallet, ChevronLeft, ChevronRight, Upload, Image as ImageIcon, Calendar, Users, AlertTriangle, Gift, Lock, Unlock } from "lucide-react";
import { sortByNestedEmployeeId } from "@/lib/utils/sort-employees";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface PayrollLockInfo {
  lockedAt: string;
  lockedBy: string;
  totalNet: number;
  recordCount: number;
}

interface PayrollViewProps {
  records: any[];
  isAdmin: boolean;
  currentMonth: number;
  currentYear: number;
  monthLocked?: boolean;
  lockInfo?: PayrollLockInfo | null;
}

export function PayrollView({ records, isAdmin, currentMonth, currentYear, monthLocked = false, lockInfo = null }: PayrollViewProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [locking, setLocking] = useState(false);
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

  async function handleLock() {
    if (records.length === 0) {
      toast.error("Generate payroll first before locking");
      return;
    }
    const ok = typeof window !== "undefined" && window.confirm(
      `Lock ${monthName} payroll?\n\n` +
      `This will freeze all ${records.length} records and create an immutable snapshot. ` +
      `Auto-regeneration will stop. You can unlock from this screen at any time.`
    );
    if (!ok) return;
    setLocking(true);
    try {
      const res = await fetch("/api/payroll/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: currentMonth, year: currentYear }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to lock");
      toast.success(`${monthName} locked — PKR ${Math.round(data.totalNet).toLocaleString()} snapshot created`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLocking(false);
    }
  }

  async function handleUnlock() {
    const ok = typeof window !== "undefined" && window.confirm(
      `Unlock ${monthName} payroll?\n\n` +
      `This will delete the snapshot and allow records to be regenerated again.`
    );
    if (!ok) return;
    setLocking(true);
    try {
      const res = await fetch(`/api/payroll/lock?month=${currentMonth}&year=${currentYear}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to unlock");
      toast.success(`${monthName} unlocked`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLocking(false);
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

  // Group records by department, sorted by employee ID
  const grouped: Record<string, any[]> = {};
  records.forEach((rec: any) => {
    const dept = rec.user.department?.name || "Other";
    if (!grouped[dept]) grouped[dept] = [];
    grouped[dept].push(rec);
  });
  // Sort each department's records by employee ID
  for (const dept of Object.keys(grouped)) {
    grouped[dept] = sortByNestedEmployeeId(grouped[dept]);
  }
  const deptOrder = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  function renderTable(deptRecords: any[], deptName: string) {
    const deptTotal = deptRecords.reduce((s: number, r: any) => s + r.netSalary, 0);
    return (
      <Card key={deptName} className="overflow-hidden border-0 shadow-sm">
        <CardHeader className="pb-2 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold">{deptName} Team</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[9px] h-5">{deptRecords.length} employees</Badge>
              <Badge className="text-[9px] h-5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">
                PKR {deptTotal.toLocaleString()}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-xs font-semibold py-2">Employee</TableHead>
                {isAdmin && <TableHead className="text-xs font-semibold py-2 text-center">Status</TableHead>}
                <TableHead className="text-xs font-semibold py-2 text-right">Salary</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-center">Absents</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">Fine</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">After Fine</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">Bonus</TableHead>
                <TableHead className="text-xs font-semibold py-2 text-right">Final Salary</TableHead>
                {isAdmin && <TableHead className="text-xs font-semibold py-2">Account</TableHead>}
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
                    {/* HIRED/PROBATION Status — CEO only */}
                    {isAdmin && (
                      <TableCell className="text-center py-2.5">
                        <Badge className={`text-[10px] px-1.5 ${rec.user.status === "HIRED" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}`}>
                          {rec.user.status}
                        </Badge>
                      </TableCell>
                    )}
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
                    {/* Account Details — CEO only */}
                    {isAdmin && (
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
                    )}
                    {/* Proof — only visible after paid */}
                    <TableCell className="text-center py-2.5">
                      {rec.status === "PAID" ? (
                        <>
                          {rec.paymentProof ? (
                            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-blue-600 gap-1" onClick={() => setProofPreview(rec.paymentProof)}>
                              <ImageIcon className="size-3" /> View
                            </Button>
                          ) : null}
                          {isAdmin && (
                            <label className="cursor-pointer block mt-0.5">
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadProof(rec.id, f); e.target.value = ""; }} />
                              <span className="text-[10px] text-blue-500 hover:underline">{uploadingId === rec.id ? "..." : (rec.paymentProof ? "Update" : "+ Add")}</span>
                            </label>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
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
              {/* Department Total Row — CEO only */}
              {isAdmin && (
                <TableRow className="bg-muted/20 border-t-2">
                  <TableCell colSpan={7} className="text-right text-xs font-semibold py-2">
                    {deptName} Total:
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <span className="text-sm font-bold">Rs{deptTotal.toLocaleString()}</span>
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  const paidCount = records.filter((r: any) => r.status === "PAID").length;

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
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={generating || locking || monthLocked}
              size="sm"
              className="gap-2 rounded-lg"
              title={monthLocked ? "Month is locked — unlock to regenerate" : ""}
            >
              <Calculator className="size-4" />
              {generating ? "Generating..." : "Generate Payroll"}
            </Button>
            {monthLocked ? (
              <Button
                onClick={handleUnlock}
                disabled={locking}
                size="sm"
                variant="outline"
                className="gap-2 rounded-lg border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
              >
                <Unlock className="size-4" />
                {locking ? "Unlocking..." : "Unlock"}
              </Button>
            ) : (
              <Button
                onClick={handleLock}
                disabled={locking || generating || records.length === 0}
                size="sm"
                variant="outline"
                className="gap-2 rounded-lg"
              >
                <Lock className="size-4" />
                {locking ? "Locking..." : "Lock Month"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Lock banner */}
      {isAdmin && monthLocked && lockInfo && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/50">
            <Lock className="size-4 text-amber-700 dark:text-amber-400" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-300">
              {monthName} is locked
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-400/80 mt-0.5">
              Snapshot created {format(new Date(lockInfo.lockedAt), "MMM d, yyyy 'at' hh:mm a")}
              {lockInfo.lockedBy ? ` by ${lockInfo.lockedBy}` : ""} •{" "}
              {lockInfo.recordCount} records • PKR {Math.round(lockInfo.totalNet).toLocaleString()} total.
              Records are frozen and will not auto-regenerate.
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {records.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Wallet className="size-3.5 text-blue-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Payable</p>
              </div>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">PKR {totalNet.toLocaleString()}</p>
            </CardContent>
          </Card>
          {isAdmin && (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800">
              <CardContent className="py-3.5 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="size-3.5 text-rose-500" />
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Fines</p>
                </div>
                <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">PKR {totalFines.toLocaleString()}</p>
              </CardContent>
            </Card>
          )}
          {isAdmin && (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
              <CardContent className="py-3.5 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <Gift className="size-3.5 text-emerald-500" />
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Bonuses</p>
                </div>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">PKR {totalIncentives.toLocaleString()}</p>
              </CardContent>
            </Card>
          )}
          <Card className="border-0 shadow-sm">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="size-3.5 text-slate-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isAdmin ? "Paid" : "Status"}</p>
              </div>
              <p className="text-2xl font-bold">{isAdmin ? `${paidCount}/${records.length}` : (records[0]?.status === "PAID" ? "Paid" : "Pending")}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Department Tables */}
      {deptOrder.map((dept) => renderTable(grouped[dept], dept))}

      {records.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Wallet className="size-7 text-muted-foreground/40" />
            </div>
            <p className="text-muted-foreground font-semibold">No Payroll Records</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {isAdmin ? "Click 'Generate Payroll' to calculate salaries for " + monthName : "Payroll for " + monthName + " has not been generated yet"}
            </p>
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
