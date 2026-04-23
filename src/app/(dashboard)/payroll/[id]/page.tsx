"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function PayslipPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/payroll/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="p-4">Loading payslip...</div>;
  if (!data) return <div className="p-4">Payslip not found.</div>;

  const monthName = format(new Date(data.year, data.month - 1), "MMMM yyyy");

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Payslip"
        description={`${data.user.firstName} ${data.user.lastName} — ${monthName}`}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Monthly Salary Statement
            </CardTitle>
            <Badge variant={data.status === "PAID" ? "default" : "outline"}>
              {data.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <InfoRow label="Employee" value={`${data.user.firstName} ${data.user.lastName}`} />
            <InfoRow label="Employee ID" value={data.user.employeeId} />
            <InfoRow label="Department" value={data.user.department?.name || "—"} />
            <InfoRow label="Designation" value={data.user.designation || "—"} />
            <InfoRow label="Month" value={monthName} />
            <InfoRow label="Working Days" value={data.workingDays} />
          </div>

          <Separator />

          <h4 className="text-sm font-semibold">Attendance Summary</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <InfoRow label="Present Days" value={data.presentDays} />
            <InfoRow label="Absent Days" value={data.absentDays} />
            <InfoRow label="Late Days" value={data.lateDays} />
            <InfoRow label="Half Days" value={data.halfDays} />
            <InfoRow label="Paid Leave" value={data.paidLeaveDays} />
            <InfoRow label="Unpaid Leave" value={data.unpaidLeaveDays} />
          </div>

          <Separator />

          <h4 className="text-sm font-semibold">Earnings</h4>
          <div className="space-y-1 text-sm">
            <InfoRow
              label="Monthly Salary"
              value={`PKR ${data.monthlySalary.toLocaleString()}`}
            />
            <InfoRow
              label={`Daily Rate (${data.monthlySalary} / ${data.workingDays} days)`}
              value={`PKR ${data.dailyRate.toLocaleString()}`}
            />
            <InfoRow
              label="Earned Salary"
              value={`PKR ${data.earnedSalary.toLocaleString()}`}
            />
          </div>

          {data.incentives?.length > 0 && (
            <>
              <Separator />
              <h4 className="text-sm font-semibold text-green-600">Incentives</h4>
              <div className="space-y-1 text-sm">
                {data.incentives.map((inc: any) => (
                  <InfoRow
                    key={inc.id}
                    label={inc.reason}
                    value={`+ PKR ${inc.amount.toLocaleString()}`}
                  />
                ))}
                <InfoRow
                  label="Total Incentives"
                  value={`+ PKR ${data.totalIncentives.toLocaleString()}`}
                />
              </div>
            </>
          )}

          {(data.fines?.length > 0 || data.totalDeductions > 0) && (
            <>
              <Separator />
              <h4 className="text-sm font-semibold text-red-600">Deductions</h4>
              <div className="space-y-1 text-sm">
                {data.fines?.map((fine: any) => (
                  <InfoRow
                    key={fine.id}
                    label={`${fine.type}: ${fine.reason}`}
                    value={`- PKR ${fine.amount.toLocaleString()}`}
                  />
                ))}
                <InfoRow
                  label="Total Deductions"
                  value={`- PKR ${data.totalDeductions.toLocaleString()}`}
                />
              </div>
            </>
          )}

          <Separator />

          <div className="flex justify-between items-center text-lg font-bold">
            <span>Net Payable</span>
            <span>PKR {data.netSalary.toLocaleString()}</span>
          </div>

          {data.paidAt && (
            <p className="text-xs text-muted-foreground text-right">
              Paid on {format(new Date(data.paidAt), "MMM d, yyyy")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
