"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] page error:", error);
  }, [error]);

  return (
    <Card className="border-0 shadow-sm mt-6">
      <CardContent className="py-14 text-center">
        <div className="size-14 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
          <AlertTriangle className="size-7 text-amber-600 dark:text-amber-400" />
        </div>
        <p className="text-sm font-semibold">Temporary server hiccup</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-md mx-auto">
          The database is busy right now. This usually resolves itself in a few seconds.
          Click retry or refresh the page.
        </p>
        <Button onClick={reset} variant="outline" className="gap-2">
          <RefreshCw className="size-4" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}
