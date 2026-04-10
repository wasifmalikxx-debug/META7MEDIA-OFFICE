"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  ShoppingBag,
  Link2,
  ExternalLink,
  ClipboardList,
  FileText,
  Lock,
  StickyNote,
  Megaphone,
} from "lucide-react";
import { formatPKTDisplay } from "@/lib/pkt";

interface Report {
  id: string;
  date: string;
  listingsCount: number | null;
  storeName: string | null;
  listingLinks: string | null;
  postsCount: number | null;
  pageNames: string | null;
  notes: string | null;
  createdAt: string;
}

interface MyReportsViewProps {
  reports: Report[];
  currentMonth: number;
  currentYear: number;
  employeeId: string;
}

export function MyReportsView({ reports, currentMonth, currentYear, employeeId }: MyReportsViewProps) {
  const router = useRouter();
  const isManager = employeeId === "EM-4"; // Izaan — simple notes-only template
  const isEtsy = employeeId.startsWith("EM") && !isManager;
  const isFB = employeeId.startsWith("SMM");

  const monthName = formatPKTDisplay(
    new Date(Date.UTC(currentYear, currentMonth - 1, 1)),
    "MMMM yyyy"
  );

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (m < 1) {
      m = 12;
      y--;
    }
    router.push(`/my-reports?month=${m}&year=${y}`);
  }

  // Summary stats for the visible month
  const totalReports = reports.length;
  const totalListings = reports.reduce((s, r) => s + (r.listingsCount || 0), 0);
  const totalPosts = reports.reduce((s, r) => s + (r.postsCount || 0), 0);
  const reportsWithNotes = reports.filter((r) => r.notes && r.notes.trim().length > 0).length;

  return (
    <div className="space-y-5">
      {/* Privacy banner */}
      <div className="rounded-lg border border-violet-200 dark:border-violet-900/50 bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/30 px-4 py-2.5 flex items-center gap-3">
        <Lock className="size-4 text-violet-600 dark:text-violet-400 shrink-0" />
        <p className="text-[11px] text-violet-800 dark:text-violet-300">
          <strong>Private archive.</strong> Only you can see these reports. Organized by date, refreshed automatically at the end of each month. Read-only.
        </p>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(-1)}
            className="size-9 rounded-full"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-[200px] justify-center">
            <CalendarIcon className="size-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">{monthName}</h2>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(1)}
            className="size-9 rounded-full"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="size-3.5 text-blue-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Reports Submitted
              </p>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalReports}</p>
          </CardContent>
        </Card>
        {isEtsy && (
          <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList className="size-3.5 text-emerald-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Listings
                </p>
              </div>
              <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalListings}</p>
            </CardContent>
          </Card>
        )}
        {isFB && (
          <Card className="border-0 shadow-sm bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Megaphone className="size-3.5 text-sky-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Posts
                </p>
              </div>
              <p className="text-3xl font-bold text-sky-600 dark:text-sky-400">{totalPosts}</p>
            </CardContent>
          </Card>
        )}
        {isManager && (
          <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="size-3.5 text-amber-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Team Lead Reports
                </p>
              </div>
              <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{totalReports}</p>
            </CardContent>
          </Card>
        )}
        <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <StickyNote className="size-3.5 text-amber-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                With Notes
              </p>
            </div>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {reportsWithNotes}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reports list */}
      {reports.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 mx-auto rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center mb-3">
              <FileText className="size-7 text-slate-500" />
            </div>
            <p className="text-sm font-semibold">No reports for {monthName}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Daily reports you submit before checkout will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {reports.map((r) => {
            const links = r.listingLinks?.split("\n").map((l) => l.trim()).filter(Boolean) || [];
            const pages = r.pageNames?.split(",").map((p) => p.trim()).filter(Boolean) || [];
            return (
              <Card key={r.id} className="border-0 shadow-sm">
                <CardContent className="p-0">
                  {/* Date header */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="size-3.5 text-muted-foreground" />
                      <p className="text-sm font-bold">
                        {formatPKTDisplay(new Date(r.date), "EEEE, MMMM d, yyyy")}
                      </p>
                    </div>
                    {isEtsy && r.listingsCount !== null && (
                      <Badge className="text-[10px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 gap-1">
                        <ClipboardList className="size-2.5" />
                        {r.listingsCount} listings
                      </Badge>
                    )}
                    {isFB && r.postsCount !== null && (
                      <Badge className="text-[10px] h-5 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 border-0 gap-1">
                        <Megaphone className="size-2.5" />
                        {r.postsCount} posts
                      </Badge>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-4 space-y-3">
                    {isEtsy && r.storeName && (
                      <div className="flex items-center gap-2 text-xs">
                        <ShoppingBag className="size-3.5 text-emerald-500 shrink-0" />
                        <span className="text-muted-foreground">Store:</span>
                        <span className="font-semibold">{r.storeName}</span>
                      </div>
                    )}

                    {isEtsy && links.length > 0 && (
                      <div className="flex items-start gap-2 text-xs">
                        <Link2 className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                            Listing Links ({links.length})
                          </p>
                          <div className="space-y-0.5 max-h-[120px] overflow-y-auto rounded bg-muted/20 p-2">
                            {links.map((link, i) => (
                              <a
                                key={i}
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-[11px] truncate"
                              >
                                <ExternalLink className="size-2.5 shrink-0" />
                                <span className="truncate">{link}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {isFB && pages.length > 0 && (
                      <div className="flex items-start gap-2 text-xs">
                        <Megaphone className="size-3.5 text-sky-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                            Pages
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {pages.map((p, i) => (
                              <span
                                key={i}
                                className="text-[10px] px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-900"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {r.notes && r.notes.trim().length > 0 && (
                      <div className="flex items-start gap-2 text-xs">
                        <StickyNote className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">
                            Notes
                          </p>
                          <div className="rounded bg-amber-50/40 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/50 px-3 py-2">
                            <p className="text-[11px] whitespace-pre-wrap leading-relaxed">
                              {r.notes}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Empty body fallback */}
                    {!r.storeName && links.length === 0 && pages.length === 0 && !r.notes && (
                      <p className="text-[11px] text-muted-foreground italic">
                        No details recorded for this report.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
