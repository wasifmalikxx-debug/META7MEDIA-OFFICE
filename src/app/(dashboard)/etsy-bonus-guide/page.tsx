import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Target, Star, DollarSign, ShieldAlert,
  CheckCircle, XCircle, Camera, ArrowRight, Sparkles, Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

function Section({ icon: Icon, title, color, children }: { icon: any; title: string; color: string; children: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className={`flex items-center gap-3 px-5 py-3.5 border-b ${color}`}>
          <div className="rounded-lg bg-white/80 dark:bg-black/20 p-2">
            <Icon className="size-4" />
          </div>
          <h3 className="font-bold text-sm">{title}</h3>
        </div>
        <div className="px-5 py-4 text-sm">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function EtsyBonusGuidePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userRole = (session.user as any).role;
  const employeeId = (session.user as any).employeeId || "";

  if (userRole !== "SUPER_ADMIN" && userRole !== "MANAGER" && !employeeId.startsWith("EM")) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="Etsy Bonus Guide"
        description="Everything you need to know about the E-Commerce bonus program"
      />

      {/* Overview Banner */}
      <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800 overflow-hidden">
        <CardContent className="py-5 px-5">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
              <Sparkles className="size-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Monthly Performance Bonus</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Meet all 7 criteria + reach $1,000 profit = unlock unlimited bonus scaling. No cap on earnings.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 7 Criteria */}
      <Section icon={CheckCircle} title="7 Qualifying Criteria" color="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
        <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/10 p-3 mb-3">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
            ALL 7 must pass. If any single one fails, all bonuses become zero.
          </p>
        </div>
        <div className="grid gap-2">
          {[
            { num: 1, title: "Daily Listings", desc: "All required listings completed on time every day" },
            { num: 2, title: "Orders Processed Same Day", desc: "Every order processed on the day it comes in" },
            { num: 3, title: "Messages Cleared", desc: "Customer messages cleared daily — no backlog" },
            { num: 4, title: "Zero Wrong Orders", desc: "No wrong orders or shipping mistakes for the entire month" },
            { num: 5, title: "Max 3 Listings Removed", desc: "Maximum 3 listings removed by Etsy — any more = disqualified" },
            { num: 6, title: "All Stores Above 4 Stars", desc: "Every store must maintain above 4-star rating" },
            { num: 7, title: "Profit >= $1,000", desc: "Total combined monthly profit across all stores" },
          ].map((item) => (
            <div key={item.num} className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-muted/20 transition-colors">
              <div className="size-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-400 shrink-0 mt-0.5">
                {item.num}
              </div>
              <div>
                <p className="font-semibold text-xs">{item.title}</p>
                <p className="text-[11px] text-muted-foreground">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Profit Tiers */}
      <Section icon={DollarSign} title="Profit-Based Bonus Tiers" color="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
        <div className="rounded-lg border bg-muted/30 p-3 mb-3 font-mono text-xs">
          <p className="font-bold">Formula: floor(profit / $500) x PKR 5,000</p>
          <p className="text-muted-foreground mt-0.5">No cap — the more profit, the higher the bonus.</p>
        </div>

        <div className="grid gap-1.5">
          {[
            { profit: "Below $1,000", bonus: "Not Eligible", color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/20" },
            { profit: "$1,000", bonus: "PKR 10,000", color: "text-emerald-600", bg: "" },
            { profit: "$1,500", bonus: "PKR 15,000", color: "text-emerald-600", bg: "bg-muted/20" },
            { profit: "$2,000", bonus: "PKR 20,000", color: "text-emerald-600", bg: "" },
            { profit: "$2,500", bonus: "PKR 25,000", color: "text-emerald-600", bg: "bg-muted/20" },
            { profit: "$3,000", bonus: "PKR 30,000", color: "text-emerald-600", bg: "" },
            { profit: "$5,000", bonus: "PKR 50,000", color: "text-emerald-700 font-bold", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
            { profit: "$10,000", bonus: "PKR 100,000", color: "text-emerald-700 font-bold", bg: "" },
          ].map((tier, i) => (
            <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${tier.bg}`}>
              <span className="font-medium">{tier.profit}</span>
              <span className={`font-semibold ${tier.color}`}>{tier.bonus}</span>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground mt-3">
          Between tiers, bonus stays at the lower tier. E.g., $1,200 profit = PKR 10,000 (same as $1,000 tier).
        </p>
      </Section>

      {/* Review Bonus */}
      <Section icon={Star} title="Review Fix Bonus — PKR 500 Per Fix" color="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Star className="size-4 text-rose-500 fill-rose-500" />
                <span className="text-sm font-bold text-rose-600">1-3</span>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div className="flex items-center gap-1">
                <Star className="size-4 text-emerald-500 fill-emerald-500" />
                <span className="text-sm font-bold text-emerald-600">4-5</span>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">=</span>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">PKR 500</Badge>
          </div>

          <div className="space-y-2 text-muted-foreground">
            <div className="flex items-start gap-2.5">
              <Camera className="size-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span className="text-xs">Submit <strong>before and after screenshots</strong> as proof of the rating change</span>
            </div>
            <div className="flex items-start gap-2.5">
              <Users className="size-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span className="text-xs">CEO or Manager reviews and approves the submission</span>
            </div>
            <div className="flex items-start gap-2.5">
              <Target className="size-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span className="text-xs"><strong>2-minute edit window</strong> after submitting — then it locks</span>
            </div>
            <div className="flex items-start gap-2.5">
              <XCircle className="size-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span className="text-xs">Only awarded if main <strong>7-criteria eligibility is met</strong></span>
            </div>
          </div>
        </div>
      </Section>

      {/* Important Rules */}
      <Section icon={ShieldAlert} title="Important Rules" color="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400">
        <div className="space-y-3">
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 p-3">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-400">All-or-Nothing Rule</p>
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
              If ANY of the 7 criteria fails, ALL bonuses become zero — profit bonus, review bonus, everything. No partial credit.
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400">Probation Employees</p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              Employees on PROBATION status are not eligible for any bonuses. Incentives begin once status changes to HIRED.
            </p>
          </div>

          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3">
            <p className="text-xs font-bold text-blue-700 dark:text-blue-400">Profit Source</p>
            <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
              Profit data is auto-fetched from your individual Google Sheet. Make sure your &quot;AFTER TAX&quot; values are accurate and up to date.
            </p>
          </div>
        </div>
      </Section>

      <p className="text-[10px] text-center text-muted-foreground/40 pb-4 pt-2">
        META7MEDIA — E-Commerce Bonus Program Guide
      </p>
    </div>
  );
}
