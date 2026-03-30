"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Calendar, ShoppingBag, Megaphone, FileText, Link2, Users, ExternalLink } from "lucide-react";

interface DailyReportViewProps {
  reports: any[];
  currentMonth: number;
  currentYear: number;
}

export function DailyReportView({ reports, currentMonth, currentYear }: DailyReportViewProps) {
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

  // Monthly totals
  const totalEtsyListings = etsyReports.reduce((s: number, r: any) => s + (r.listingsCount || 0), 0);
  const totalFBPosts = fbReports.reduce((s: number, r: any) => s + (r.postsCount || 0), 0);
  const uniqueEtsyEmployees = new Set(etsyReports.map((r: any) => r.user.employeeId)).size;
  const uniqueFBEmployees = new Set(fbReports.map((r: any) => r.user.employeeId)).size;

  function groupByDate(items: any[]) {
    const grouped: Record<string, any[]> = {};
    items.forEach((r: any) => {
      const dateKey = format(new Date(r.date), "yyyy-MM-dd");
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(r);
    });
    return Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));
  }

  const etsyGrouped = groupByDate(etsyReports);
  const fbGrouped = groupByDate(fbReports);

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

      {/* Monthly Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag className="size-3.5 text-emerald-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Etsy Listings</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalEtsyListings}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{etsyReports.length} reports from {uniqueEtsyEmployees} employees</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Megaphone className="size-3.5 text-blue-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">FB Posts</p>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalFBPosts}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{fbReports.length} reports from {uniqueFBEmployees} employees</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="size-3.5 text-slate-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Reports</p>
            </div>
            <p className="text-3xl font-bold">{reports.length}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">This month</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-800">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="size-3.5 text-violet-500" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Active Staff</p>
            </div>
            <p className="text-3xl font-bold text-violet-600 dark:text-violet-400">{uniqueEtsyEmployees + uniqueFBEmployees}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Submitted at least 1 report</p>
          </CardContent>
        </Card>
      </div>

      {reports.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <FileText className="size-6 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground font-medium">No reports for {monthName}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Employee daily reports will appear here</p>
          </CardContent>
        </Card>
      )}

      {/* Etsy Team Reports */}
      {etsyGrouped.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <ShoppingBag className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Etsy Team</h3>
                <p className="text-[10px] text-muted-foreground">{totalEtsyListings} total listings this month</p>
              </div>
            </div>
          </div>
          {etsyGrouped.map(([dateStr, dayReports]) => {
            const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE, MMMM d");
            const totalListings = dayReports.reduce((s: number, r: any) => s + (r.listingsCount || 0), 0);
            return (
              <Card key={dateStr} className="border-0 shadow-sm overflow-hidden">
                <CardHeader className="py-2.5 px-4 bg-emerald-50/50 dark:bg-emerald-950/15 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-bold">{dateLabel}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] h-5">{dayReports.length} report{dayReports.length !== 1 ? "s" : ""}</Badge>
                      <Badge className="text-[9px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">{totalListings} listings</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-muted/30">
                    {dayReports.map((r: any) => (
                      <div key={r.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <div className="size-7 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                              {r.user.firstName[0]}{r.user.lastName?.[0] || ""}
                            </div>
                            <div>
                              <span className="text-sm font-semibold">{r.user.firstName} {r.user.lastName}</span>
                              <span className="text-[10px] text-muted-foreground ml-1.5 font-mono bg-muted/50 px-1.5 py-0.5 rounded">{r.user.employeeId}</span>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] font-bold gap-1">
                            <FileText className="size-2.5" />
                            {r.listingsCount || 0} listings
                          </Badge>
                        </div>
                        <div className="ml-9.5 pl-0.5 space-y-1.5">
                          {r.storeName && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <ShoppingBag className="size-3 text-muted-foreground shrink-0" />
                              <span className="text-muted-foreground">Store:</span>
                              <span className="font-medium">{r.storeName}</span>
                            </div>
                          )}
                          {r.listingLinks && (
                            <div className="flex items-start gap-1.5 text-xs">
                              <Link2 className="size-3 text-muted-foreground shrink-0 mt-0.5" />
                              <div className="space-y-0.5">
                                {r.listingLinks.split("\n").filter(Boolean).map((link: string, i: number) => (
                                  <a key={i} href={link.trim()} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[400px]">
                                    {link.trim()}
                                    <ExternalLink className="size-2.5 shrink-0" />
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                          {r.notes && (
                            <p className="text-[11px] text-muted-foreground italic">&quot;{r.notes}&quot;</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* FB Team Reports */}
      {fbGrouped.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Megaphone className="size-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Facebook Team</h3>
                <p className="text-[10px] text-muted-foreground">{totalFBPosts} total posts this month</p>
              </div>
            </div>
          </div>
          {fbGrouped.map(([dateStr, dayReports]) => {
            const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE, MMMM d");
            const totalPosts = dayReports.reduce((s: number, r: any) => s + (r.postsCount || 0), 0);
            return (
              <Card key={dateStr} className="border-0 shadow-sm overflow-hidden">
                <CardHeader className="py-2.5 px-4 bg-blue-50/50 dark:bg-blue-950/15 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-bold">{dateLabel}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] h-5">{dayReports.length} report{dayReports.length !== 1 ? "s" : ""}</Badge>
                      <Badge className="text-[9px] h-5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">{totalPosts} posts</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-muted/30">
                    {dayReports.map((r: any) => (
                      <div key={r.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <div className="size-7 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                              {r.user.firstName[0]}{r.user.lastName?.[0] || ""}
                            </div>
                            <div>
                              <span className="text-sm font-semibold">{r.user.firstName} {r.user.lastName}</span>
                              <span className="text-[10px] text-muted-foreground ml-1.5 font-mono bg-muted/50 px-1.5 py-0.5 rounded">{r.user.employeeId}</span>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] font-bold gap-1">
                            <Megaphone className="size-2.5" />
                            {r.postsCount || 0} posts
                          </Badge>
                        </div>
                        <div className="ml-9.5 pl-0.5 space-y-1.5">
                          {r.pageNames && (
                            <div className="flex items-start gap-1.5 text-xs">
                              <Users className="size-3 text-muted-foreground shrink-0 mt-0.5" />
                              <div>
                                <span className="text-muted-foreground">Pages: </span>
                                <span className="font-medium">{r.pageNames}</span>
                              </div>
                            </div>
                          )}
                          {r.notes && (
                            <p className="text-[11px] text-muted-foreground italic">&quot;{r.notes}&quot;</p>
                          )}
                        </div>
                      </div>
                    ))}
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
