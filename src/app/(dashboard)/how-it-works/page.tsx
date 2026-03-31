import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Clock, Calendar, Wallet, AlertTriangle, Coffee, ShieldCheck,
  Smartphone, Ban, CreditCard, Timer, FileText, CalendarDays,
} from "lucide-react";

export const dynamic = "force-dynamic";

function PolicyCard({ icon: Icon, title, color, children }: { icon: any; title: string; color: string; children: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className={`flex items-center gap-3 px-5 py-3.5 border-b ${color}`}>
          <div className="rounded-lg bg-white/80 dark:bg-black/20 p-2">
            <Icon className="size-4" />
          </div>
          <h3 className="font-bold text-sm">{title}</h3>
        </div>
        <div className="px-5 py-4 text-sm space-y-2">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-muted-foreground">
      <div className="size-1.5 rounded-full bg-current mt-2 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export default async function HowItWorksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="How It Works"
        description="Complete guide to META7MEDIA office policies, rules, and system behavior"
      />

      <PolicyCard icon={Clock} title="Working Hours" color="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
        <Rule>Office hours: <strong>11:00 AM - 7:00 PM PKT</strong> (8-hour work day)</Rule>
        <Rule>Check-in opens at <strong>10:30 AM</strong> (30 minutes before office start)</Rule>
        <Rule>Check-out available from <strong>6:30 PM</strong></Rule>
        <Rule>Auto check-out at <strong>7:30 PM</strong> if you forget (forced by system)</Rule>
        <Rule>Working days: <strong>Monday - Saturday</strong>. Sunday is a day off</Rule>
        <Rule>Official holidays are added by CEO — no attendance or fines on those days</Rule>
      </PolicyCard>

      <PolicyCard icon={Calendar} title="Attendance Rules" color="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
        <Rule>Daily check-in is <strong>mandatory</strong>. No check-in = marked absent at 7:33 PM</Rule>
        <Rule>Hours tracked = check-out time - check-in time - break time</Rule>
        <Rule>If you work less than <strong>6 hours</strong> (75% of full day), it counts as half day</Rule>
        <Rule>Minimum <strong>4 hours</strong> required before you can check out</Rule>
        <Rule><strong>Daily work report must be submitted</strong> before checking out</Rule>
        <Rule>Grace period: <strong>10 minutes</strong> after 11:00 AM before late fine applies</Rule>
      </PolicyCard>

      <PolicyCard icon={AlertTriangle} title="Late Arrival Fines" color="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
        <Rule>Fines are <strong>auto-applied</strong> based on how late you arrive:</Rule>
        <div className="rounded-lg border bg-muted/30 p-3 my-1">
          <div className="grid grid-cols-2 gap-1 text-xs">
            <span className="font-semibold">After 11:10 AM (10 min late)</span><span className="text-right font-bold text-rose-600">PKR 100</span>
            <span className="font-semibold">After 11:30 AM (30 min late)</span><span className="text-right font-bold text-rose-600">PKR 200</span>
            <span className="font-semibold">After 12:00 PM (60 min late)</span><span className="text-right font-bold text-rose-600">PKR 300</span>
          </div>
        </div>
        <Rule>Only the <strong>highest matching tier</strong> applies (not cumulative)</Rule>
        <Rule>WhatsApp notification sent when a late fine is issued</Rule>
        <Rule>Fines are deducted from your monthly salary automatically</Rule>
      </PolicyCard>

      <PolicyCard icon={Coffee} title="Break Policy" color="bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400">
        <div className="rounded-lg border bg-muted/30 p-3 my-1">
          <div className="grid grid-cols-2 gap-1 text-xs">
            <span className="font-semibold">Mon, Tue, Wed, Thu, Sat</span><span className="text-right font-bold">3:00 PM - 4:00 PM</span>
            <span className="font-semibold">Friday (Jummah)</span><span className="text-right font-bold">1:30 PM - 2:45 PM</span>
          </div>
        </div>
        <Rule>You <strong>MUST</strong> click <strong>Start Break</strong> and <strong>End Break</strong> buttons</Rule>
        <Rule>Minimum break duration: <strong>15 minutes</strong></Rule>
        <Rule>Grace period after break ends: <strong>5 minutes</strong></Rule>
        <Rule>Late return from break: <strong>PKR 100 fine</strong> (auto-applied)</Rule>
        <Rule><strong>Skipping break attendance</strong> (not clicking Start Break at all): <strong>PKR 100 fine</strong></Rule>
        <Rule>This means you left for break without letting the system know — the fine is applied at checkout</Rule>
        <Rule>Break time is <strong>not counted</strong> in your working hours</Rule>
      </PolicyCard>

      <PolicyCard icon={Ban} title="Absence Policy" color="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400">
        <Rule>If not checked in by <strong>7:33 PM</strong>, you are automatically marked <strong>absent</strong></Rule>
        <Rule>Absent fine = <strong>Monthly Salary / 30</strong> per day</Rule>
        <Rule>First absence is covered by your <strong>paid leave budget</strong> (no deduction)</Rule>
        <Rule>After budget is used, full daily rate is deducted from salary</Rule>
        <Rule>Weekends (Sunday) and official holidays are <strong>never</strong> marked absent</Rule>
      </PolicyCard>

      <PolicyCard icon={CalendarDays} title="Paid Leave (Rollover)" color="bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400">
        <Rule><strong>1 paid leave per month</strong> — earned automatically</Rule>
        <Rule>Unused leaves <strong>roll over</strong> to the next month and accumulate</Rule>
        <div className="rounded-lg border bg-violet-50 dark:bg-violet-950/20 p-3 my-1">
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-1">Example:</p>
          <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
            <span>Month 1 — no leave taken</span><span className="text-right font-medium">1.0 day saved</span>
            <span>Month 2 — no leave taken</span><span className="text-right font-medium">2.0 days available</span>
            <span>Month 3 — took 1 day off</span><span className="text-right font-medium">2.0 days remaining</span>
            <span>Month 4 — no leave taken</span><span className="text-right font-medium">3.0 days available</span>
          </div>
        </div>
        <Rule>Half days consume <strong>0.5</strong> from your budget each</Rule>
        <Rule>Auto-applied to absences — <strong>no application needed</strong> for full-day coverage</Rule>
        <Rule>Your pending leave balance is shown on your dashboard</Rule>
        <Rule>If budget is <strong>0</strong>, the &quot;Apply Half Day&quot; button is hidden</Rule>
      </PolicyCard>

      <PolicyCard icon={Timer} title="Half Day Leave" color="bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
        <Rule>Two types: <strong>First Half</strong> (arrive after break) or <strong>Second Half</strong> (leave after break)</Rule>
        <Rule><strong>Today&apos;s date:</strong> only Second Half allowed (must check in and work 4 hours first)</Rule>
        <Rule><strong>Future dates:</strong> both First Half and Second Half available</Rule>
        <Rule>First Half leave: you check in after break time — <strong>no late fine</strong></Rule>
        <Rule>Second Half leave: requires <strong>daily report submission</strong> before applying</Rule>
        <Rule>Half day = <strong>0.5</strong> from your paid leave budget</Rule>
        <Rule><strong>15-minute cancel window</strong> for same-day leaves</Rule>
      </PolicyCard>

      <PolicyCard icon={FileText} title="Daily Work Report" color="bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-400">
        <Rule>You <strong>must submit a daily report before checking out</strong></Rule>
        <Rule><strong>Etsy team (EM-):</strong> How many listings, store name, listing links</Rule>
        <Rule><strong>Facebook team (SMM-):</strong> How many posts, page names</Rule>
        <Rule>Optional notes field available for both teams</Rule>
        <Rule>One report per day — can be updated if submitted again</Rule>
        <div className="rounded-lg border bg-rose-50 dark:bg-rose-950/20 p-3 my-1">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">
            If you are auto-checked out at 7:30 PM without submitting your report, a PKR 100 fine is applied automatically and you will receive a notification.
          </p>
        </div>
        <Rule>CEO sees all reports grouped by date and team</Rule>
      </PolicyCard>

      <PolicyCard icon={Wallet} title="Salary Formula" color="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400">
        <div className="rounded-lg bg-muted/50 p-4 font-mono text-xs space-y-1 border">
          <p className="text-muted-foreground">Daily Rate = Monthly Salary / 30</p>
          <p className="text-muted-foreground">Absent Deduction = Uncovered Absents x Daily Rate</p>
          <p className="text-muted-foreground">Half Day Deduction = Uncovered Half Days x Daily Rate x 0.5</p>
          <p className="font-bold mt-2 pt-2 border-t">Net Salary = Monthly Salary + Incentives - All Deductions - Fines</p>
        </div>
        <Rule>Estimated salary updates <strong>live</strong> on your dashboard</Rule>
        <Rule>Covered absences (paid leave) have <strong>zero deduction</strong></Rule>
      </PolicyCard>

      <PolicyCard icon={CreditCard} title="Payroll" color="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 mb-2">
          <p className="font-semibold text-emerald-700 dark:text-emerald-400 text-xs">
            Salaries are processed through Bank Alfalah between the 5th-10th of every month
          </p>
        </div>
        <Rule>Payment proofs are automatically added from banking partner</Rule>
        <Rule>Make sure your <strong>bank details are updated</strong> before the 5th</Rule>
        <Rule>You can update bank details from your Profile at any time</Rule>
        <Rule>View payroll history for any month from the Payroll page</Rule>
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-3 mt-2">
          <p className="font-semibold text-rose-700 dark:text-rose-400 text-[11px]">
            META7MEDIA is not responsible for payments sent to incorrect bank details. Ensure your details are correct before the 5th.
          </p>
        </div>
      </PolicyCard>

      <PolicyCard icon={ShieldCheck} title="Login Security" color="bg-slate-100 dark:bg-slate-800/50 text-slate-700 dark:text-slate-400">
        <Rule>First login requires <strong>one-time CEO approval</strong></Rule>
        <Rule>Only <strong>one device</strong> per employee (browser fingerprint secured)</Rule>
        <Rule>New device login is <strong>blocked</strong> until approved by CEO</Rule>
        <Rule>CEO can revoke device access at any time</Rule>
      </PolicyCard>

      <PolicyCard icon={Smartphone} title="WhatsApp Notifications" color="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400">
        <Rule>Late arrival fine notification</Rule>
        <Rule>Break late / skip fine notification</Rule>
        <Rule>Absence notification</Rule>
        <Rule>No report fine notification</Rule>
        <Rule>Salary paid notification with breakdown</Rule>
        <Rule>You must send &quot;hi&quot; to the business WhatsApp number first to receive messages</Rule>
      </PolicyCard>

      <p className="text-[10px] text-center text-muted-foreground/40 pb-4 pt-2">
        META7MEDIA AI Office Manager — Developed by Wasif Malik, CEO
      </p>
    </div>
  );
}
