"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ChevronLeft, ChevronRight, Calendar, ShoppingBag, Megaphone,
  FileText, Link2, Users, ExternalLink, ClipboardList, AlertTriangle,
} from "lucide-react";
import { extractEtsyListingId, type DuplicateHit } from "@/lib/services/duplicate-listings";

interface DailyReportViewProps {
  reports: any[];
  currentMonth: number;
  currentYear: number;
  duplicatesByReport?: Record<string, DuplicateHit[]>;
}

export function DailyReportView({
  reports,
  currentMonth,
  currentYear,
  duplicatesByReport = {},
}: DailyReportViewProps) {
  const router = useRouter();
  const monthName = format(new Date(currentYear, currentMonth - 1), "MMMM yyyy");

  function goMonth(offset: number) {
    let m = currentMonth + offset;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    router.push(`/daily-work-report?month=${m}&year=${y}`);
  }

  const etsyReports = reports.filter((r: any) => r.user.employeeId.startsWith("EM"));
  const fbReports = reports.filter((r: any) => r.user.employeeId.startsWith("SMM"));
  const totalEtsyListings = etsyReports.reduce((s: number, r: any) => s + (r.listingsCount || 0), 0);
  const totalFBPosts = fbReports.reduce((s: number, r: any) => s + (r.postsCount || 0), 0);
  const uniqueEtsyEmployees = new Set(etsyReports.map((r: any) => r.user.employeeId)).size;
  const uniqueFBEmployees = new Set(fbReports.map((r: any) => r.user.employeeId)).size;

  // Count duplicate hits that belong to reports visible in THIS month's view.
  // The detection window is 3 months (server side), but the KPI is scoped to
  // what the CEO can see below — so "0" always means "no duplicates on the
  // current screen". Reports with internal repeats (same link pasted twice)
  // and reports echoing a link from a prior month both count.
  const visibleReportIds = new Set(reports.map((r: any) => r.id));
  let totalDuplicateHits = 0;
  let reportsWithDuplicates = 0;
  for (const rid of Object.keys(duplicatesByReport)) {
    if (!visibleReportIds.has(rid)) continue;
    const hits = duplicatesByReport[rid] || [];
    if (hits.length === 0) continue;
    totalDuplicateHits += hits.length;
    reportsWithDuplicates += 1;
  }

  // Helper: duplicate hit for a given link within a given report, if any.
  function dupHitFor(reportId: string, link: string): DuplicateHit | undefined {
    const hits = duplicatesByReport[reportId];
    if (!hits || hits.length === 0) return undefined;
    const id = extractEtsyListingId(link);
    if (!id) return undefined;
    // If the same ID was flagged multiple times in the report (internal
    // duplicate), the exact string match identifies which instance we're
    // on. Fall back to ID match for query-param variants.
    return hits.find((h) => h.link === link.trim()) || hits.find((h) => h.listingId === id);
  }

  // Group ALL reports by date (both teams together)
  const grouped: Record<string, { etsy: any[]; fb: any[] }> = {};
  reports.forEach((r: any) => {
    const dateKey = format(new Date(r.date), "yyyy-MM-dd");
    if (!grouped[dateKey]) grouped[dateKey] = { etsy: [], fb: [] };
    if (r.user.employeeId.startsWith("EM")) grouped[dateKey].etsy.push(r);
    else if (r.user.employeeId.startsWith("SMM")) grouped[dateKey].fb.push(r);
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  function renderEtsyReport(r: any) {
    // Izaan (EM-4) is the team manager — uses a simple notes-only template.
    // Render him with a distinct amber manager card instead of the listings layout.
    const isManager = r.user.employeeId === "EM-4";
    if (isManager) {
      return (
        <div key={r.id} className="flex gap-3 py-3 hover:bg-amber-50/30 dark:hover:bg-amber-950/10 px-4 transition-colors">
          <div className="size-8 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-800 dark:to-amber-700 flex items-center justify-center text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
            {r.user.firstName[0]}{r.user.lastName?.[0] || ""}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{r.user.firstName} {r.user.lastName}</span>
                <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">{r.user.employeeId}</span>
                <Badge className="text-[8px] h-4 px-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                  Team Lead
                </Badge>
              </div>
            </div>
            {r.notes && (
              <div className="flex items-start gap-1.5 text-xs mt-1.5">
                <ClipboardList className="size-3 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-muted-foreground text-[10px]">Daily Summary:</span>
                  <p className="font-medium text-[11px] whitespace-pre-line mt-0.5">{r.notes}</p>
                </div>
              </div>
            )}
            {!r.notes && (
              <p className="text-[10px] text-muted-foreground italic mt-1">No summary recorded.</p>
            )}
          </div>
        </div>
      );
    }

    // Regular Etsy employee layout
    const links = r.listingLinks?.split("\n").filter(Boolean) || [];
    const reportHits = duplicatesByReport[r.id] || [];
    const hasDuplicates = reportHits.length > 0;
    return (
      <div
        key={r.id}
        className={`flex gap-3 py-3 px-4 transition-colors ${
          hasDuplicates
            ? "hover:bg-rose-50/40 dark:hover:bg-rose-950/15"
            : "hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10"
        }`}
      >
        <div className="size-8 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-800 dark:to-emerald-700 flex items-center justify-center text-[10px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
          {r.user.firstName[0]}{r.user.lastName?.[0] || ""}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{r.user.firstName} {r.user.lastName}</span>
              <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">{r.user.employeeId}</span>
              {hasDuplicates && (
                <Tooltip>
                  <TooltipTrigger className="inline-flex items-center">
                    <Badge className="text-[9px] h-5 bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border-0 gap-1">
                      <AlertTriangle className="size-2.5" />
                      {reportHits.length} duplicate{reportHits.length === 1 ? "" : "s"}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {reportHits.length === 1
                      ? "1 listing in this report was already submitted earlier."
                      : `${reportHits.length} listings in this report were already submitted earlier.`}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge className="text-[9px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 gap-1">
                <ClipboardList className="size-2.5" />{r.listingsCount || 0} listings
              </Badge>
            </div>
          </div>
          <div className="mt-1.5 space-y-1">
            {r.storeName && (
              <div className="flex items-center gap-1.5 text-xs">
                <ShoppingBag className="size-3 text-emerald-500 shrink-0" />
                <span className="font-medium">{r.storeName}</span>
              </div>
            )}
            {links.length > 0 && (
              <div className="flex items-start gap-1.5 text-xs">
                <Link2 className="size-3 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-0.5 max-h-[80px] overflow-y-auto">
                  {links.map((link: string, i: number) => {
                    const hit = dupHitFor(r.id, link);
                    return (
                      <div key={i} className="flex items-center gap-1.5">
                        <a
                          href={link.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-1 hover:underline truncate max-w-[450px] ${
                            hit
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-blue-600 dark:text-blue-400"
                          }`}
                        >
                          {link.trim()}
                          <ExternalLink className="size-2.5 shrink-0" />
                        </a>
                        {hit && (
                          <Tooltip>
                            <TooltipTrigger className="inline-flex items-center">
                              <span className="text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-rose-600 text-white leading-none">
                                DUP
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              <div className="font-semibold mb-0.5">Duplicate listing</div>
                              <div>
                                Listing ID <span className="font-mono">{hit.listingId}</span>{" "}
                                {hit.firstSubmission.sameReport ? (
                                  <>was already included earlier in this same report.</>
                                ) : (
                                  <>
                                    was first submitted by{" "}
                                    <span className="font-semibold">
                                      {hit.firstSubmission.employeeName}
                                    </span>{" "}
                                    ({hit.firstSubmission.employeeId}) on{" "}
                                    <span className="font-semibold">
                                      {format(new Date(hit.firstSubmission.date + "T00:00:00"), "MMM d, yyyy")}
                                    </span>
                                    .
                                  </>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {r.notes && (
              <p className="text-[10px] text-muted-foreground italic mt-1">{r.notes}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderFBReport(r: any) {
    const pages = r.pageNames?.split("\n").filter(Boolean) || [];
    return (
      <div key={r.id} className="flex gap-3 py-3 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 px-4 transition-colors">
        <div className="size-8 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-800 dark:to-blue-700 flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-300 shrink-0">
          {r.user.firstName[0]}{r.user.lastName?.[0] || ""}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{r.user.firstName} {r.user.lastName}</span>
              <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">{r.user.employeeId}</span>
            </div>
            <Badge className="text-[9px] h-5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0 gap-1">
              <Megaphone className="size-2.5" />{r.postsCount || 0} posts
            </Badge>
          </div>
          <div className="mt-1.5 space-y-1.5">
            {pages.length > 0 && (
              <div className="flex items-start gap-1.5 text-xs">
                <Users className="size-3 text-blue-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="text-muted-foreground text-[10px]">Pages:</span>
                  {pages.map((page: string, i: number) => (
                    <div key={i} className="font-medium">{page.trim()}</div>
                  ))}
                </div>
              </div>
            )}
            {!pages.length && r.pageNames && (
              <div className="flex items-center gap-1.5 text-xs">
                <Users className="size-3 text-blue-500 shrink-0" />
                <span className="text-muted-foreground text-[10px]">Pages:</span>
                <span className="font-medium">{r.pageNames}</span>
              </div>
            )}
            {r.postsCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <FileText className="size-3 text-blue-500 shrink-0" />
                <span className="text-muted-foreground text-[10px]">Published:</span>
                <span className="font-medium">{r.postsCount} post{r.postsCount !== 1 ? "s" : ""} / reel{r.postsCount !== 1 ? "s" : ""}</span>
              </div>
            )}
            {r.notes && (
              <div className="flex items-start gap-1.5 text-xs mt-1">
                <ClipboardList className="size-3 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-muted-foreground text-[10px]">Daily Summary:</span>
                  <p className="font-medium text-[11px] whitespace-pre-line mt-0.5">{r.notes}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => goMonth(-1)} className="size-9 rounded-full">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-[200px] justify-center">
            <Calendar className="size-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">{monthName}</h2>
          </div>
          <Button variant="outline" size="icon" onClick={() => goMonth(1)} className="size-9 rounded-full">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Monthly KPI Cards.
          When there are no FB reports in the dataset (e.g. Izaan's Etsy-
          scoped view), the FB Posts card is hidden and the grid falls
          back to 4 columns so the remaining cards stay balanced (the
          Duplicate Listings tile always shows). */}
      <div className={`grid grid-cols-2 gap-3 ${fbReports.length > 0 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag className="size-3.5 text-emerald-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Etsy Listings</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalEtsyListings}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{uniqueEtsyEmployees} employees</p>
          </CardContent>
        </Card>
        {fbReports.length > 0 && (
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
            <CardContent className="py-3.5 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Megaphone className="size-3.5 text-blue-500" />
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">FB Posts</p>
              </div>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalFBPosts}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{uniqueFBEmployees} employees</p>
            </CardContent>
          </Card>
        )}
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="size-3.5 text-slate-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Reports</p>
            </div>
            <p className="text-3xl font-bold">{reports.length}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">This month</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="size-3.5 text-violet-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Days Covered</p>
            </div>
            <p className="text-3xl font-bold text-violet-600 dark:text-violet-400">{sortedDates.length}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Working days with reports</p>
          </CardContent>
        </Card>
        <Card className={`border-0 shadow-sm ${totalDuplicateHits > 0 ? "bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-800" : ""}`}>
          <CardContent className="py-3.5 px-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className={`size-3.5 ${totalDuplicateHits > 0 ? "text-rose-500" : "text-muted-foreground"}`} />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Duplicates</p>
            </div>
            <p className={`text-3xl font-bold ${totalDuplicateHits > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
              {totalDuplicateHits}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {totalDuplicateHits === 0
                ? "No duplicates detected"
                : `Across ${reportsWithDuplicates} report${reportsWithDuplicates === 1 ? "" : "s"}`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Empty State */}
      {reports.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <FileText className="size-7 text-muted-foreground/40" />
            </div>
            <p className="text-muted-foreground font-semibold">No Reports Yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Employee daily reports for {monthName} will appear here</p>
          </CardContent>
        </Card>
      )}

      {/* Daily Feed — Grouped by Date, Both Teams Under Each Day */}
      {sortedDates.map((dateStr) => {
        const day = grouped[dateStr];
        const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE, MMMM d");
        const dayListings = day.etsy.reduce((s: number, r: any) => s + (r.listingsCount || 0), 0);
        const dayPosts = day.fb.reduce((s: number, r: any) => s + (r.postsCount || 0), 0);
        const totalReports = day.etsy.length + day.fb.length;

        return (
          <Card key={dateStr} className="border-0 shadow-sm overflow-hidden">
            {/* Date Header */}
            <CardHeader className="py-3 px-5 bg-muted/30 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold">{dateLabel}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px] h-5">{totalReports} report{totalReports !== 1 ? "s" : ""}</Badge>
                  {dayListings > 0 && (
                    <Badge className="text-[9px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                      {dayListings} listings
                    </Badge>
                  )}
                  {dayPosts > 0 && (
                    <Badge className="text-[9px] h-5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">
                      {dayPosts} posts
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Etsy Section */}
              {day.etsy.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-5 py-2 bg-emerald-50/40 dark:bg-emerald-950/10 border-b border-muted/20">
                    <ShoppingBag className="size-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Etsy Team</span>
                    <span className="text-[10px] text-muted-foreground">({day.etsy.length})</span>
                  </div>
                  <div className="divide-y divide-muted/20">
                    {day.etsy.map(renderEtsyReport)}
                  </div>
                </div>
              )}

              {/* FB Section */}
              {day.fb.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-5 py-2 bg-blue-50/40 dark:bg-blue-950/10 border-b border-t border-muted/20">
                    <Megaphone className="size-3 text-blue-600 dark:text-blue-400" />
                    <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Facebook Team</span>
                    <span className="text-[10px] text-muted-foreground">({day.fb.length})</span>
                  </div>
                  <div className="divide-y divide-muted/20">
                    {day.fb.map(renderFBReport)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
