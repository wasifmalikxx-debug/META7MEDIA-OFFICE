import { Card, CardContent } from "@/components/ui/card";
import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  variant?: "default" | "success" | "warning" | "danger";
}

const variantStyles = {
  default: "border-0 shadow-sm",
  success: "border-0 shadow-sm bg-emerald-50/50 dark:bg-emerald-950/20",
  warning: "border-0 shadow-sm bg-amber-50/50 dark:bg-amber-950/20",
  danger: "border-0 shadow-sm bg-rose-50/50 dark:bg-rose-950/20",
};

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  trendValue,
  variant = "default",
}: StatCardProps) {
  return (
    <Card className={cn(variantStyles[variant])}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold tracking-tight whitespace-nowrap">{value}</p>
          </div>
          {Icon && (
            <div className="rounded-xl bg-muted/60 dark:bg-muted/30 p-2.5">
              <Icon className="size-5 text-muted-foreground" />
            </div>
          )}
        </div>
        {(description || trend) && (
          <div className="flex items-center gap-1.5 mt-2">
            {trend && trend !== "neutral" && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-xs font-semibold",
                  trend === "up" ? "text-emerald-600" : "text-rose-600"
                )}
              >
                {trend === "up" ? (
                  <TrendingUp className="size-3" />
                ) : (
                  <TrendingDown className="size-3" />
                )}
                {trendValue}
              </span>
            )}
            {description && (
              <p className="text-[11px] text-muted-foreground">{description}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
