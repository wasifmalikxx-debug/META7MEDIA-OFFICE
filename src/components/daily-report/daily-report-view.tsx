"use client";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Calendar, ShoppingBag, Megaphone } from "lucide-react";

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

  // Split by team
  const etsyReports = reports.filter((r: any) => r.user.employeeId.startsWith("EM"));
  const fbReports = reports.filter((r: any) => r.user.employeeId.startsWith("SMM"));

  // Group by date
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
    <div className="space-y-4">
      {/* Month Navigation */}
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
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs gap-1"><ShoppingBag className="size-3" />{etsyReports.length} Etsy</Badge>
          <Badge variant="outline" className="text-xs gap-1"><Megaphone className="size-3" />{fbReports.length} FB</Badge>
        </div>
      </div>

      {reports.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Calendar className="size-6 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground font-medium">No reports for {monthName}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Employee daily reports will appear here</p>
          </CardContent>
        </Card>
      )}

      {/* Etsy Team Reports */}
      {etsyGrouped.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-emerald-600" />
            <h3 className="text-sm font-bold uppercase tracking-wider">Etsy Team</h3>
          </div>
          {etsyGrouped.map(([dateStr, dayReports]) => {
            const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE, MMMM d");
            const totalListings = dayReports.reduce((s: number, r: any) => s + (r.listingsCount || 0), 0);
            return (
              <Card key={dateStr} className="border-0 shadow-sm overflow-hidden">
                <CardHeader className="pb-2 bg-emerald-50/50 dark:bg-emerald-950/20 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold">{dateLabel}</CardTitle>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-[10px] font-normal">{dayReports.length} report{dayReports.length !== 1 ? "s" : ""}</Badge>
                      <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">{totalListings} listings</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/10">
                        <TableHead className="text-xs py-2">Employee</TableHead>
                        <TableHead className="text-xs py-2 text-center">Listings</TableHead>
                        <TableHead className="text-xs py-2">Store</TableHead>
                        <TableHead className="text-xs py-2">Links</TableHead>
                        <TableHead className="text-xs py-2">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayReports.map((r: any) => (
                        <TableRow key={r.id} className="hover:bg-muted/5">
                          <TableCell className="py-2.5">
                            <span className="text-sm font-medium">{r.user.firstName} {r.user.lastName}</span>
                            <span className="text-xs text-muted-foreground ml-1">({r.user.employeeId})</span>
                          </TableCell>
                          <TableCell className="text-center py-2.5">
                            <Badge variant="outline" className="text-xs font-semibold">{r.listingsCount || 0}</Badge>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span className="text-sm">{r.storeName || "—"}</span>
                          </TableCell>
                          <TableCell className="py-2.5 max-w-[250px]">
                            {r.listingLinks ? (
                              <div className="text-xs text-blue-600 dark:text-blue-400 space-y-0.5 max-h-[60px] overflow-y-auto">
                                {r.listingLinks.split("\n").filter(Boolean).map((link: string, i: number) => (
                                  <div key={i} className="truncate">
                                    <a href={link.trim()} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                      {link.trim()}
                                    </a>
                                  </div>
                                ))}
                              </div>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span className="text-xs text-muted-foreground">{r.notes || "—"}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* FB Team Reports */}
      {fbGrouped.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-blue-600" />
            <h3 className="text-sm font-bold uppercase tracking-wider">Facebook Team</h3>
          </div>
          {fbGrouped.map(([dateStr, dayReports]) => {
            const dateLabel = format(new Date(dateStr + "T00:00:00"), "EEEE, MMMM d");
            const totalPosts = dayReports.reduce((s: number, r: any) => s + (r.postsCount || 0), 0);
            return (
              <Card key={dateStr} className="border-0 shadow-sm overflow-hidden">
                <CardHeader className="pb-2 bg-blue-50/50 dark:bg-blue-950/20 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold">{dateLabel}</CardTitle>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-[10px] font-normal">{dayReports.length} report{dayReports.length !== 1 ? "s" : ""}</Badge>
                      <Badge className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">{totalPosts} posts</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/10">
                        <TableHead className="text-xs py-2">Employee</TableHead>
                        <TableHead className="text-xs py-2 text-center">Posts</TableHead>
                        <TableHead className="text-xs py-2">Pages</TableHead>
                        <TableHead className="text-xs py-2">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayReports.map((r: any) => (
                        <TableRow key={r.id} className="hover:bg-muted/5">
                          <TableCell className="py-2.5">
                            <span className="text-sm font-medium">{r.user.firstName} {r.user.lastName}</span>
                            <span className="text-xs text-muted-foreground ml-1">({r.user.employeeId})</span>
                          </TableCell>
                          <TableCell className="text-center py-2.5">
                            <Badge variant="outline" className="text-xs font-semibold">{r.postsCount || 0}</Badge>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span className="text-sm">{r.pageNames || "—"}</span>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span className="text-xs text-muted-foreground">{r.notes || "—"}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
