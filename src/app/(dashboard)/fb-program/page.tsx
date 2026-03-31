import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import {
  Rocket, Megaphone, Target, TrendingUp, Users, BarChart3,
  Clock, Sparkles,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FBProgramPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Facebook Bonus Program"
        description="Social Media Marketing team incentive program"
      />

      {/* Coming Soon Hero */}
      <Card className="border-0 shadow-sm overflow-hidden bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-blue-950/40 dark:via-slate-800 dark:to-indigo-950/30">
        <CardContent className="py-10 px-6">
          <div className="flex flex-col items-center text-center space-y-5">
            <div className="relative">
              <div className="size-20 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shadow-lg shadow-blue-200/50 dark:shadow-blue-950/50">
                <Rocket className="size-10 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="absolute -top-1 -right-1 size-6 bg-amber-400 rounded-full flex items-center justify-center animate-pulse">
                <Sparkles className="size-3.5 text-white" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold">Coming Soon</h2>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                We are building an exciting bonus program for the Social Media Marketing team. This program will reward outstanding performance, consistency, and growth.
              </p>
            </div>
            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0 text-xs gap-1.5 px-4 py-1.5">
              <Clock className="size-3" />
              Under Development
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* What to Expect */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="px-5 py-3.5 border-b bg-muted/20">
            <h3 className="text-sm font-bold">What to Expect</h3>
          </div>
          <div className="px-5 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { icon: Megaphone, title: "Content Performance Bonuses", desc: "Rewards based on reach, engagement, and content quality across all managed pages", color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30" },
                { icon: Target, title: "Campaign Target Bonuses", desc: "Hit monthly campaign targets and client deliverables to earn additional incentives", color: "text-violet-600 bg-violet-100 dark:bg-violet-900/30" },
                { icon: TrendingUp, title: "Growth Milestones", desc: "Bonus rewards for achieving follower growth, page reach, and engagement milestones", color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30" },
                { icon: BarChart3, title: "Monthly Analytics Review", desc: "Performance tracked through analytics and reports — transparent and data-driven", color: "text-amber-600 bg-amber-100 dark:bg-amber-900/30" },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/20 transition-colors">
                  <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${item.color}`}>
                    <item.icon className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Rules */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="px-5 py-3.5 border-b bg-muted/20">
            <h3 className="text-sm font-bold">In the Meantime</h3>
          </div>
          <div className="px-5 py-4 space-y-2">
            <div className="flex items-start gap-2.5 text-muted-foreground">
              <div className="size-1.5 rounded-full bg-current mt-2 shrink-0" />
              <span className="text-xs">Continue submitting your <strong>daily work reports</strong> — they are mandatory before checkout</span>
            </div>
            <div className="flex items-start gap-2.5 text-muted-foreground">
              <div className="size-1.5 rounded-full bg-current mt-2 shrink-0" />
              <span className="text-xs">Maintain <strong>excellent attendance</strong> — it will factor into future bonus calculations</span>
            </div>
            <div className="flex items-start gap-2.5 text-muted-foreground">
              <div className="size-1.5 rounded-full bg-current mt-2 shrink-0" />
              <span className="text-xs">Focus on <strong>quality content</strong> and <strong>client satisfaction</strong> — these metrics will be tracked</span>
            </div>
            <div className="flex items-start gap-2.5 text-muted-foreground">
              <div className="size-1.5 rounded-full bg-current mt-2 shrink-0" />
              <span className="text-xs">The program details will be announced via <strong>WhatsApp</strong> and the <strong>How It Works</strong> page</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-[10px] text-center text-muted-foreground/40 pb-4 pt-2">
        META7MEDIA — Social Media Marketing Team
      </p>
    </div>
  );
}
