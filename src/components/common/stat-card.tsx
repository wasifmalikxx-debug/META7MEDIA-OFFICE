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

/**
 * Variants now carry their colour in the icon well rather than washing the
 * whole card. A grid of four tinted panels reads as noise; a neutral card
 * with one coloured accent keeps the number the loudest thing on screen.
 */
const iconStyles = {
  default: "bg-muted text-muted-foreground",
  success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  warning: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  danger: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
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
    <Card className="gap-0 transition-shadow hover:shadow-sm">
      <CardContent className="pb-1 pt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="whitespace-nowrap text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
              {value}
            </p>
          </div>
          {Icon && (
            <div className={cn("shrink-0 rounded-lg p-2", iconStyles[variant])}>
              <Icon className="size-[18px]" />
            </div>
          )}
        </div>
        {(description || trend) && (
          <div className="mt-2 flex items-center gap-1.5">
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
              <p className="truncate text-[11px] text-muted-foreground">{description}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
