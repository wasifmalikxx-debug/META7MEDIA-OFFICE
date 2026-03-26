import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock, Calendar, Wallet, AlertTriangle, Coffee, ShieldCheck,
  Smartphone, Ban, CreditCard, Timer,
} from "lucide-react";

export default async function HowItWorksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Office Policies"
        description="Complete guide to META7MEDIA office rules, attendance, fines, leaves, and payroll"
      />

      {/* Working Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="size-5" /> Working Hours
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Office hours: <strong>11:00 AM - 7:00 PM</strong></li>
            <li>Check-in available from <strong>10:30 AM</strong></li>
            <li>Full work day = <strong>8 hours</strong></li>
          </ul>
        </CardContent>
      </Card>

      {/* Attendance Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="size-5" /> Attendance Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Daily check-in is <strong>required</strong></li>
            <li>Check-out is only allowed <strong>at or after 7:00 PM</strong></li>
            <li>Hours are tracked from check-in to check-out (minus break time)</li>
          </ul>
        </CardContent>
      </Card>

      {/* Late Arrival Fines */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="size-5" /> Late Arrival Fines
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Fines are auto-applied based on how late you arrive. Only the <strong>highest matching tier</strong> applies (not cumulative).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold">Late By</th>
                  <th className="text-right py-2 font-semibold">Fine</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b"><td className="py-2">Up to 10 minutes</td><td className="text-right">PKR 100</td></tr>
                <tr className="border-b"><td className="py-2">Up to 30 minutes</td><td className="text-right">PKR 200</td></tr>
                <tr><td className="py-2">Up to 60 minutes</td><td className="text-right">PKR 300</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Fines are issued automatically and deducted from your monthly salary.</p>
        </CardContent>
      </Card>

      {/* Break Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coffee className="size-5" /> Break Policy
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Break window: <strong>3:00 PM - 4:00 PM</strong></li>
            <li>You must click <strong>Start Break</strong> and <strong>End Break</strong></li>
            <li>Minimum break duration: <strong>15 minutes</strong></li>
            <li>Grace period after break ends: <strong>5 minutes</strong></li>
            <li>Late return from break: <strong>PKR 100 fine</strong> (auto-applied)</li>
            <li>Break time is not counted in your working hours</li>
          </ul>
        </CardContent>
      </Card>

      {/* Absence Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Ban className="size-5" /> Absence Policy
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>If not checked in by <strong>7:30 PM</strong>, you are marked <strong>absent</strong></li>
            <li>A daily cron job automatically marks absences</li>
            <li>Absent fine = <strong>salary / 30</strong> per day (1 day&apos;s pay deducted)</li>
            <li>First absence each month is covered by paid leave (see below)</li>
          </ul>
        </CardContent>
      </Card>

      {/* Paid Leave */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="size-5" /> Paid Leave
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li><strong>1 paid leave per month</strong></li>
            <li>Auto-applied to your first absence — <strong>no application needed</strong></li>
            <li>2 half days = 1 paid leave</li>
            <li>Budget resets on 1st of every month</li>
            <li>For a full day absence, no application is required — it is auto-detected</li>
          </ul>
        </CardContent>
      </Card>

      {/* Half Day Leave */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Timer className="size-5" /> Half Day Leave
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Must complete <strong>minimum 4 hours</strong> before applying for today</li>
            <li>Can apply for <strong>today or future dates</strong> only (not past dates)</li>
            <li>A valid reason is required</li>
            <li>Half day = <strong>0.5</strong> from your paid leave budget</li>
            <li>System auto-checks you out when you apply half day for today</li>
            <li><strong>15-minute cancel window</strong> for same-day half days — after that, it is locked</li>
          </ul>
        </CardContent>
      </Card>

      {/* Salary Formula */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="size-5" /> Salary Formula
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-lg bg-muted/50 p-4 font-mono text-xs space-y-1">
            <p>Daily Rate = Monthly Salary / 30</p>
            <p className="pt-2 font-semibold">Estimated Salary = Monthly Salary + Incentives - Fines - Absence Deductions</p>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Your estimated salary is shown on the dashboard and updates <strong>live</strong></li>
            <li>Deductions include unpaid absences, half days, and fines</li>
            <li>Incentives are added on top of base salary</li>
          </ul>
        </CardContent>
      </Card>

      {/* Payroll */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="size-5" /> Payroll
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4 mb-3">
            <p className="font-semibold text-green-700 dark:text-green-400">
              Salaries are automated through our banking partner — Bank Alfalah
            </p>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Salaries are paid between the <strong>5th - 10th of every month</strong></li>
            <li>Payments are processed automatically through <strong>Bank Alfalah</strong></li>
            <li>Payment proofs are automatically added from our banking partner</li>
            <li>Make sure your <strong>bank details are updated</strong> before the payment timeline</li>
            <li>You can update your bank details from your profile at any time</li>
            <li>Payroll shows: gross salary, present days, absences, fines, incentives, and net payable</li>
            <li>You can view payroll history for any month</li>
          </ul>
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-4 mt-3">
            <p className="font-semibold text-red-700 dark:text-red-400 text-xs">
              Important: If your bank details are not updated or are incorrect, the payment will still be processed automatically. META7MEDIA will not be responsible for payments sent to wrong accounts. Please ensure your bank details are correct before the 5th of every month.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Login Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="size-5" /> Login Security
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>First login requires <strong>one-time CEO approval</strong></li>
            <li>Only <strong>one device</strong> is allowed per employee</li>
            <li>Logging in from a new device will be <strong>blocked</strong> until approved by the CEO</li>
            <li>CEO can revoke device access at any time</li>
          </ul>
        </CardContent>
      </Card>

      {/* WhatsApp Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="size-5" /> WhatsApp Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-muted-foreground mb-2">If your phone number is registered, you receive notifications for:</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Fine notifications (late arrival, break overrun, manual fines)</li>
            <li>Salary paid notification with full breakdown</li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-center text-muted-foreground/50 pb-4">
        DEVELOPED BY: WASIF MALIK - CEO META7MEDIA
      </p>
    </div>
  );
}
