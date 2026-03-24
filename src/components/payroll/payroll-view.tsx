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
import { Calculator, CheckCircle, Wallet } from "lucide-react";

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

  const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    DRAFT: "outline",
    CALCULATED: "secondary",
    APPROVED: "default",
    PAID: "default",
    DISPUTED: "destructive",
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Net Payable</p>
              <p className="text-lg font-bold">PKR {totalNet.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Fines</p>
              <p className="text-lg font-bold text-red-600">
                PKR {totalFines.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Incentives</p>
              <p className="text-lg font-bold text-green-600">
                PKR {totalIncentives.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 flex items-center justify-center">
              <Button onClick={handleGenerate} disabled={generating} className="gap-2">
                <Calculator className="size-4" />
                {generating ? "Generating..." : "Generate Payroll"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Payroll — {format(new Date(currentYear, currentMonth - 1), "MMMM yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Monthly Salary</TableHead>
                <TableHead>Present</TableHead>
                <TableHead>Absent</TableHead>
                <TableHead>Earned</TableHead>
                <TableHead>Fines</TableHead>
                <TableHead>Incentives</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net Salary</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 11 : 10}
                    className="text-center text-muted-foreground"
                  >
                    No payroll records. {isAdmin && "Click 'Generate Payroll' to start."}
                  </TableCell>
                </TableRow>
              ) : (
                records.map((rec) => (
                  <TableRow key={rec.id} className="cursor-pointer" onClick={() => router.push(`/payroll/${rec.id}`)}>
                    <TableCell className="text-sm">
                      <div>
                        {rec.user.firstName} {rec.user.lastName}
                        <span className="text-muted-foreground text-xs block">
                          {rec.user.employeeId}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      PKR {rec.monthlySalary.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{rec.presentDays}</TableCell>
                    <TableCell className="text-sm">{rec.absentDays}</TableCell>
                    <TableCell className="text-sm">
                      PKR {rec.earnedSalary.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-red-600">
                      {rec.totalFines > 0 ? `- ${rec.totalFines.toLocaleString()}` : "0"}
                    </TableCell>
                    <TableCell className="text-sm text-green-600">
                      {rec.totalIncentives > 0
                        ? `+ ${rec.totalIncentives.toLocaleString()}`
                        : "0"}
                    </TableCell>
                    <TableCell className="text-sm text-red-600">
                      {rec.totalDeductions > 0
                        ? `- ${rec.totalDeductions.toLocaleString()}`
                        : "0"}
                    </TableCell>
                    <TableCell className="text-sm font-bold">
                      PKR {rec.netSalary.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusColors[rec.status] || "outline"}
                        className="text-xs"
                      >
                        {rec.status}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          {rec.status === "DRAFT" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleStatusUpdate(rec.id, "APPROVED")}
                            >
                              <CheckCircle className="size-3 mr-1" /> Approve
                            </Button>
                          )}
                          {rec.status === "APPROVED" && (
                            <Button
                              size="sm"
                              onClick={() => handleStatusUpdate(rec.id, "PAID")}
                            >
                              <Wallet className="size-3 mr-1" /> Mark Paid
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
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
