import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock, Calendar, Wallet, AlertTriangle, Coffee, ShieldCheck,
  CheckCircle, XCircle, Smartphone, Gift
} from "lucide-react";

export default async function HowItWorksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = (session.user as any).role === "SUPER_ADMIN";

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="How It Works"
        description="Complete guide to META7MEDIA Office Manager — policies, rules, and formulas"
      />

      {/* Attendance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="size-5" /> Attendance System
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h4 className="font-semibold mb-1">Daily Check-in / Check-out</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Office hours: <strong>11:00 AM - 7:00 PM</strong></li>
              <li>Grace period: <strong>10 minutes</strong> (check-in before 11:10 AM = on time)</li>
              <li>After grace period = <strong>LATE</strong> (fine applies automatically)</li>
              <li>If you don&apos;t check in at all = <strong>ABSENT</strong> (detected at end of day)</li>
              <li>If you physically check in, you are never marked absent — only LATE</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Working Hours</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Full day = <strong>8 hours</strong> of work</li>
              <li>Hours are tracked from check-in to check-out (minus break time)</li>
              <li>Your &quot;Hours Worked&quot; updates in real-time on your dashboard</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Absent Rules</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>If you don&apos;t check in for the day = marked <strong>ABSENT</strong></li>
              <li>Absent = salary deduction of <strong>1 day&apos;s pay</strong> (unless covered by paid leave)</li>
              <li>System auto-checks out employees who forget to check out at end of day</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Break Time */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coffee className="size-5" /> Break Time Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Break window: <strong>2:00 PM - 3:00 PM</strong> (1 hour)</li>
            <li>&quot;Start Break&quot; button only appears during break window</li>
            <li>Before 2:00 PM: shows &quot;Break starts at 14:00&quot;</li>
            <li>After 3:00 PM without starting: shows &quot;Break missed&quot;</li>
            <li>Minimum break duration: <strong>15 minutes</strong> (can&apos;t end break before 15 min)</li>
            <li>Grace period after break ends: <strong>5 minutes</strong></li>
            <li>If you return after 3:05 PM: <strong>PKR 200 fine</strong> auto-applied</li>
            <li>You must click &quot;End Break&quot; yourself — your return time is recorded</li>
            <li>Break time is NOT counted in your working hours</li>
          </ul>
        </CardContent>
      </Card>

      {/* Late Fine Tiers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="size-5" /> Late Fine Tiers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">Fines are auto-applied based on how late you arrive:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold">Late By</th>
                  <th className="text-right py-2 font-semibold">Fine Amount</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b"><td className="py-2">10 - 30 minutes</td><td className="text-right">PKR 100</td></tr>
                <tr className="border-b"><td className="py-2">30 - 60 minutes</td><td className="text-right">PKR 300</td></tr>
                <tr><td className="py-2">60+ minutes</td><td className="text-right">PKR 500</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Fines are issued by META7 AI and deducted from your monthly salary.</p>
        </CardContent>
      </Card>

      {/* Leave Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="size-5" /> Leave Policy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h4 className="font-semibold mb-1">Paid Leave Budget</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><strong>1 paid leave per month</strong> (budget = 1.0 day)</li>
              <li>Auto-applied to your first absence — no application needed</li>
              <li>2 half days = 1 paid leave</li>
              <li>Budget resets on 1st of every month</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Half Day Leave</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>You can only apply for half day — full day absences are auto-detected</li>
              <li>Must complete <strong>4 hours minimum</strong> before applying half day for today</li>
              <li>Can pre-book half day for future dates (no threshold needed)</li>
              <li>Half day = <strong>0.5 from paid leave budget</strong></li>
              <li>When you apply half day for today, system auto-checks you out</li>
              <li>A valid reason is required</li>
              <li>Cannot apply for past dates</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-1">15-Minute Edit Window</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>After applying, you have <strong>15 minutes</strong> to edit or cancel</li>
              <li>During this time, status shows &quot;Pending&quot;</li>
              <li>After 15 minutes, it becomes &quot;Approved&quot; and cannot be changed</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Budget Examples</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Scenario</th>
                    <th className="text-right py-2 font-semibold">Budget Used</th>
                    <th className="text-right py-2 font-semibold">Deducted?</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b"><td className="py-2">1 half day</td><td className="text-right">0.5</td><td className="text-right">No</td></tr>
                  <tr className="border-b"><td className="py-2">2 half days</td><td className="text-right">1.0 (full)</td><td className="text-right">No</td></tr>
                  <tr className="border-b"><td className="py-2">1 absent</td><td className="text-right">1.0 (full)</td><td className="text-right">No</td></tr>
                  <tr className="border-b"><td className="py-2">1 half day + 1 absent</td><td className="text-right">0.5 + 0.5</td><td className="text-right">0.5 day deducted</td></tr>
                  <tr className="border-b"><td className="py-2">2 absents</td><td className="text-right">1.0 on first</td><td className="text-right">2nd fully deducted</td></tr>
                  <tr><td className="py-2">3 half days</td><td className="text-right">1.0 on first 2</td><td className="text-right">3rd = 0.5 deducted</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Salary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="size-5" /> Salary Calculation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h4 className="font-semibold mb-1">Formula</h4>
            <div className="rounded-lg bg-muted/50 p-4 font-mono text-xs space-y-1">
              <p>Daily Rate = Monthly Salary / 30</p>
              <p>Hourly Rate = Daily Rate / 8</p>
              <p className="pt-2 font-semibold">Final Salary = Monthly Salary + Incentives - Deductions</p>
              <p className="pt-1">Deductions = (Unpaid Absences x Daily Rate) + (Unpaid Half Days x 0.5 x Daily Rate) + Fines</p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Example (PKR 35,000 salary)</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="text-muted-foreground">
                  <tr className="border-b"><td className="py-2">Daily Rate</td><td className="text-right font-medium">35,000 / 30 = PKR 1,167</td></tr>
                  <tr className="border-b"><td className="py-2">Hourly Rate</td><td className="text-right font-medium">1,167 / 8 = PKR 146</td></tr>
                  <tr className="border-b"><td className="py-2">1 unpaid absent deduction</td><td className="text-right font-medium">- PKR 1,167</td></tr>
                  <tr className="border-b"><td className="py-2">1 unpaid half day deduction</td><td className="text-right font-medium">- PKR 583</td></tr>
                  <tr><td className="py-2">Late fine (Tier 1)</td><td className="text-right font-medium">- PKR 100</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Estimated Salary (Dashboard)</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Shows your <strong>real-time earned salary</strong> based on actual hours worked</li>
              <li>Formula: (Total Hours Worked x Hourly Rate) - Fines + Incentives</li>
              <li>Updates every 30 seconds while you&apos;re checked in</li>
              <li>Can go negative if fines exceed earnings early in the month</li>
              <li>Salary details are hidden by default — click &quot;Show&quot; to view</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Incentives */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gift className="size-5" /> Incentives & Bonuses
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="font-semibold text-foreground">Etsy Team — Monthly Performance Bonus</p>
          <p className="text-muted-foreground">To qualify, <strong>ALL</strong> of these must be met:</p>
          <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
            <li>Daily listings completed on time</li>
            <li>All orders processed same day</li>
            <li>Customer messages cleared daily</li>
            <li>Zero wrong orders / shipping mistakes</li>
            <li>No more than 3 listings removed by Etsy</li>
            <li>All stores maintained above 4-star rating</li>
            <li>Combined monthly profit of all stores ≥ <strong>$1,000</strong></li>
          </ol>

          <p className="font-semibold text-foreground mt-4">Bonus Tiers (PKR)</p>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2 font-medium">Monthly Profit (USD)</th>
                  <th className="text-left p-2 font-medium">Bonus (PKR)</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-t"><td className="p-2">Below $1,000</td><td className="p-2 text-red-500 font-medium">Not Eligible</td></tr>
                <tr className="border-t"><td className="p-2">$1,000</td><td className="p-2 font-medium">PKR 10,000</td></tr>
                <tr className="border-t"><td className="p-2">$1,001 – $1,499</td><td className="p-2 font-medium">PKR 10,000 (capped)</td></tr>
                <tr className="border-t"><td className="p-2">$1,500</td><td className="p-2 font-medium">PKR 15,000</td></tr>
                <tr className="border-t"><td className="p-2">$2,000</td><td className="p-2 font-medium">PKR 20,000</td></tr>
                <tr className="border-t"><td className="p-2">$2,500</td><td className="p-2 font-medium">PKR 25,000</td></tr>
                <tr className="border-t"><td className="p-2">$3,000</td><td className="p-2 font-medium">PKR 30,000</td></tr>
                <tr className="border-t bg-green-50 dark:bg-green-950"><td className="p-2">$5,000</td><td className="p-2 font-bold text-green-600">PKR 50,000 + Basic Salary</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Formula: Every $500 profit = PKR 5,000 bonus. Rounded down to nearest $500 tier.</p>

          <p className="font-semibold text-foreground mt-4">Bad Review Fix Bonus</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Fix a bad review (1-3 stars) to a good review (4-5 stars) → <strong>PKR 500 per review</strong></li>
            <li>Submit proof (before/after screenshots) for Team Lead approval</li>
          </ul>
        </CardContent>
      </Card>

      {/* Fines */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="size-5" /> Fines & Penalties
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h4 className="font-semibold mb-1">Auto-Generated Fines</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Late arrival — based on tier (PKR 100 / 300 / 500)</li>
              <li>Late return from break — PKR 200</li>
              <li>All auto-fines are issued by <strong>META7 AI</strong></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1">Manual Fines</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>CEO can add fines for policy violations, phone use, etc.</li>
              <li>You will see the fine amount, reason, and date</li>
              <li>All fines are deducted from your monthly salary</li>
            </ul>
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
            <li>Your first login requires <strong>one-time CEO approval</strong></li>
            <li>Once approved, you can login daily without any issues</li>
            <li>Logging in from any other device will be <strong>automatically blocked</strong></li>
            <li>CEO can revoke access at any time</li>
          </ul>
        </CardContent>
      </Card>

      {/* WhatsApp */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="size-5" /> WhatsApp Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">If your phone number is registered, you&apos;ll receive WhatsApp notifications for:</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Check-in confirmation (good morning message)</li>
            <li>Check-out summary (hours worked)</li>
            <li>Late arrival warning + fine notification</li>
            <li>Break late return fine</li>
            <li>Half day leave confirmation</li>
            <li>Fine or incentive added</li>
            <li>Salary processed (detailed breakdown)</li>
            <li>Forgot to check out reminder</li>
          </ul>
        </CardContent>
      </Card>

      {/* Payroll */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="size-5" /> Monthly Payroll
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Payroll is generated at the end of each month by CEO</li>
            <li>You can view your payroll for any month using the month navigator</li>
            <li>Payroll shows: gross salary, present days, absences, fines, incentives, net payable</li>
            <li>Bank account details are stored for salary transfer</li>
            <li>You can update your bank details from your profile</li>
          </ul>

          {isAdmin && (
            <div className="mt-4 p-3 rounded-lg bg-muted/50 border">
              <h4 className="font-semibold mb-1">CEO: Payroll Process</h4>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Go to Payroll page</li>
                <li>Click &quot;Generate Payroll&quot; to calculate all salaries</li>
                <li>Review the salary sheet</li>
                <li>Mark each record as &quot;Approved&quot; then &quot;Paid&quot;</li>
                <li>Employees receive WhatsApp notification with salary breakdown</li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Reset */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle className="size-5" /> Monthly Reset
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>All dashboard stats (present days, absences, late arrivals, hours worked) reset on <strong>1st of every month</strong></li>
            <li>Paid leave budget resets to <strong>1.0 day</strong></li>
            <li>Fines and incentives are tracked per month</li>
            <li>Previous months&apos; data is always available in Payroll history</li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-center text-muted-foreground/50 pb-4">
        META7MEDIA Office Manager v1.0 — Built for META7MEDIA by META7 AI
      </p>
    </div>
  );
}
