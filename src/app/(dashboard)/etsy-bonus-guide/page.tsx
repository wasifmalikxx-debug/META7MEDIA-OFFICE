import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Target, Star, Trophy, DollarSign, ShieldAlert, Users,
  FileSpreadsheet, CheckCircle, XCircle, Camera,
} from "lucide-react";

export default async function EtsyBonusGuidePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userRole = (session.user as any).role;
  const employeeId = (session.user as any).employeeId || "";

  // Only accessible to EM- employees, Manager, and CEO
  if (userRole !== "SUPER_ADMIN" && userRole !== "MANAGER" && !employeeId.startsWith("EM")) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Etsy Bonus Guide"
        description="Complete guide to the E-Commerce bonus program, review bonuses, and eligibility rules"
      />

      {/* E-Commerce Bonus Program */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="size-5" /> E-Commerce Bonus Program
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-muted-foreground mb-3">
            Monthly performance bonus based on <strong>7 criteria</strong> plus combined profit.
            All criteria must be met to qualify for any bonus.
          </p>
        </CardContent>
      </Card>

      {/* 7 Criteria */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle className="size-5" /> 7 Qualifying Criteria
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-muted-foreground mb-3">
            <strong>All 7</strong> must be met for the month. If any single one fails, all bonuses are zero.
          </p>
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
            <li><strong>Daily Listings</strong> — All required listings completed on time every day</li>
            <li><strong>Orders Processed Same Day</strong> — Every order processed on the day it comes in</li>
            <li><strong>Messages Cleared</strong> — Customer messages cleared daily, no backlog</li>
            <li><strong>Zero Wrong Orders</strong> — No wrong orders or shipping mistakes for the month</li>
            <li><strong>Listings Removed</strong> — Maximum <strong>3 listings</strong> removed by Etsy (any more = disqualified)</li>
            <li><strong>All Stores Above 4 Stars</strong> — Every store must maintain above 4-star rating</li>
            <li><strong>Combined Monthly Profit &ge; $1,000</strong> — Total profit across all stores must reach at least $1,000</li>
          </ol>
        </CardContent>
      </Card>

      {/* Profit Tiers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="size-5" /> Profit-Based Bonus Tiers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-lg bg-muted/50 p-4 font-mono text-xs space-y-1">
            <p className="font-semibold">Formula: floor(profit / 500) x PKR 5,000</p>
            <p className="text-muted-foreground">No cap. The more profit, the higher the bonus.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold">Monthly Profit (USD)</th>
                  <th className="text-right py-2 font-semibold">Bonus (PKR)</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b">
                  <td className="py-2">Below $1,000</td>
                  <td className="text-right text-red-500 font-medium">Not Eligible</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">$1,000</td>
                  <td className="text-right font-medium">PKR 10,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">$1,500</td>
                  <td className="text-right font-medium">PKR 15,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">$2,000</td>
                  <td className="text-right font-medium">PKR 20,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">$2,500</td>
                  <td className="text-right font-medium">PKR 25,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">$3,000</td>
                  <td className="text-right font-medium">PKR 30,000</td>
                </tr>
                <tr>
                  <td className="py-2">$5,000</td>
                  <td className="text-right font-bold text-green-600">PKR 50,000</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Between tiers, the bonus stays at the lower tier. E.g., $1,200 profit = PKR 10,000 (same as $1,000 tier).
          </p>
        </CardContent>
      </Card>

      {/* Review Bonus */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Star className="size-5" /> Review Fix Bonus
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
            <li>Fix a negative review (1-3 stars) to a positive review (4-5 stars) = <strong>Rs. 500 per review</strong></li>
            <li>Submit <strong>before and after screenshots</strong> as proof</li>
            <li>CEO or Manager reviews and approves the submission</li>
            <li><strong>2-minute edit window</strong> after submitting — after that, the submission is locked</li>
          </ul>
        </CardContent>
      </Card>

      {/* Team Lead Bonus */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="size-5" /> Team Lead Bonus
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Team Lead (Izaan, EM-4) receives <strong>PKR 5,000</strong> for each eligible team member</li>
            <li>A team member is &quot;eligible&quot; when they meet all 7 criteria and qualify for a profit bonus</li>
          </ul>
        </CardContent>
      </Card>

      {/* Probation Rule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="size-5" /> Probation Rule
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Employees on <strong>PROBATION</strong> status are <strong>not eligible</strong> for any incentives or bonuses</li>
            <li>This includes profit bonuses, review bonuses, and team lead bonuses</li>
            <li>Incentives begin once employee status changes to <strong>HIRED</strong></li>
          </ul>
        </CardContent>
      </Card>

      {/* All-or-Nothing Rule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <XCircle className="size-5" /> All-or-Nothing Rule
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-4 mb-3">
            <p className="font-semibold text-red-700 dark:text-red-400">
              If ANY of the 7 criteria fails, ALL bonuses are zero.
            </p>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Profit bonus = <strong>zero</strong></li>
            <li>Review bonus = <strong>zero</strong></li>
            <li>No partial credit — it is all or nothing</li>
          </ul>
        </CardContent>
      </Card>

      {/* Google Sheets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="size-5" /> Google Sheets Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Profits are auto-fetched from individual order Google Sheets</li>
            <li>The <strong>AFTER TAX</strong> value is used for profit calculations</li>
            <li>Each store has its own sheet — combined profit is summed automatically</li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-center text-muted-foreground/50 pb-4">
        META7MEDIA Etsy Bonus Guide — E-Commerce Team
      </p>
    </div>
  );
}
