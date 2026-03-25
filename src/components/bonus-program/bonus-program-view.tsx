"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Save, DollarSign, Users, Trophy, RefreshCw, Cloud } from "lucide-react";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
}

interface BonusEligibility {
  id: string;
  userId: string;
  month: number;
  year: number;
  dailyListingsComplete: boolean;
  ordersProcessedSameDay: boolean;
  messagesCleared: boolean;
  zeroWrongOrders: boolean;
  listingsRemovedCount: number;
  allStoresAbove4Stars: boolean;
  totalProfit: number;
  isEligible: boolean;
  bonusAmount: number;
  notes: string | null;
  user: { firstName: string; lastName: string; employeeId: string };
  updatedBy: { firstName: string; lastName: string } | null;
}

interface ReviewBonus {
  id: string;
  userId: string;
  amount: number;
  user: { firstName: string; lastName: string };
}

interface BonusProgramViewProps {
  employees: Employee[];
  bonusEligibilities: BonusEligibility[];
  reviewBonuses: ReviewBonus[];
  currentMonth: number;
  currentYear: number;
}

interface RowState {
  dailyListingsComplete: boolean;
  ordersProcessedSameDay: boolean;
  messagesCleared: boolean;
  zeroWrongOrders: boolean;
  listingsRemovedCount: number;
  allStoresAbove4Stars: boolean;
  totalProfit: number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Bonus Formula:
 *   < $1,000  => PKR 0 (not eligible)
 *   $1,000    => PKR 10,000
 *   $1,499    => PKR 10,000 (capped at $1,000 tier)
 *   $1,500    => PKR 15,000
 *   $2,000    => PKR 20,000
 *   $5,000    => PKR 50,000
 *
 * Core: floor(profit / 500) * 5,000 PKR
 */
function calculateBonus(state: RowState): { isEligible: boolean; bonusAmount: number; profitTier: string; nextTierAt: number | null; nextTierBonus: number | null } {
  const checkboxesMet =
    state.dailyListingsComplete &&
    state.ordersProcessedSameDay &&
    state.messagesCleared &&
    state.zeroWrongOrders &&
    state.allStoresAbove4Stars;

  const listingsOk = state.listingsRemovedCount <= 3;

  if (!checkboxesMet || !listingsOk) {
    return { isEligible: false, bonusAmount: 0, profitTier: "criteria_not_met", nextTierAt: null, nextTierBonus: null };
  }

  if (state.totalProfit < 1000) {
    return { isEligible: false, bonusAmount: 0, profitTier: "below_1000", nextTierAt: 1000, nextTierBonus: 10000 };
  }

  // floor(profit / 500) * 5,000 PKR
  const tiers = Math.floor(state.totalProfit / 500);
  const bonusAmount = tiers * 5000;
  const tierUSD = tiers * 500;
  const nextTierAt = (tiers + 1) * 500;
  const nextTierBonus = (tiers + 1) * 5000;

  return {
    isEligible: true,
    bonusAmount,
    profitTier: `$${tierUSD.toLocaleString()}`,
    nextTierAt,
    nextTierBonus,
  };
}

export function BonusProgramView({
  employees,
  bonusEligibilities,
  reviewBonuses,
  currentMonth,
  currentYear,
}: BonusProgramViewProps) {
  const router = useRouter();
  const [month, setMonth] = useState(String(currentMonth));
  const [year, setYear] = useState(String(currentYear));
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [fetchingProfits, setFetchingProfits] = useState(false);

  // Build row states from existing data
  const buildInitialStates = useCallback(() => {
    const states: Record<string, RowState> = {};
    for (const emp of employees) {
      const existing = bonusEligibilities.find(
        (b) => b.userId === emp.id
      );
      states[emp.id] = existing
        ? {
            dailyListingsComplete: existing.dailyListingsComplete,
            ordersProcessedSameDay: existing.ordersProcessedSameDay,
            messagesCleared: existing.messagesCleared,
            zeroWrongOrders: existing.zeroWrongOrders,
            listingsRemovedCount: existing.listingsRemovedCount,
            allStoresAbove4Stars: existing.allStoresAbove4Stars,
            totalProfit: existing.totalProfit,
          }
        : {
            dailyListingsComplete: true,
            ordersProcessedSameDay: true,
            messagesCleared: true,
            zeroWrongOrders: true,
            listingsRemovedCount: 0,
            allStoresAbove4Stars: true,
            totalProfit: 0,
          };
    }
    return states;
  }, [employees, bonusEligibilities]);

  const [rowStates, setRowStates] = useState<Record<string, RowState>>(buildInitialStates);
  // Fetch profits on page load only (also triggered by Fetch button)
  useEffect(() => {
    handleFetchProfits();
  }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateRow(userId: string, field: keyof RowState, value: boolean | number) {
    setRowStates((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: value },
    }));
  }

  async function handleSave(userId: string) {
    const state = rowStates[userId];
    if (!state) return;

    const { isEligible, bonusAmount } = calculateBonus(state);

    setSavingRows((prev) => ({ ...prev, [userId]: true }));
    try {
      const res = await fetch("/api/bonus-eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          month: parseInt(month),
          year: parseInt(year),
          ...state,
          isEligible,
          bonusAmount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success("Bonus eligibility saved!");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingRows((prev) => ({ ...prev, [userId]: false }));
    }
  }

  function handleMonthChange() {
    const params = new URLSearchParams({ month, year });
    router.push(`/bonus-program?${params.toString()}`);
    router.refresh();
  }

  async function handleFetchProfits() {
    setFetchingProfits(true);
    try {
      const res = await fetch(`/api/sheets-profit?month=${month}&year=${year}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");

      let updated = 0;
      let errors = 0;
      const newStates = { ...rowStates };

      for (const emp of employees) {
        const profitData = data.profits?.[emp.id];
        if (profitData?.profit !== null && profitData?.profit !== undefined) {
          newStates[emp.id] = { ...newStates[emp.id], totalProfit: profitData.profit };
          updated++;
        } else if (profitData?.error) {
          errors++;
        }
      }

      setRowStates(newStates);

      if (updated > 0) toast.success(`Fetched profits for ${updated} employees from Google Sheets`);
      if (errors > 0) toast.error(`${errors} sheets had errors — check if sheets are shared`);
      if (updated === 0 && errors === 0) toast.info("No Google Sheet URLs configured for employees");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFetchingProfits(false);
    }
  }

  // Calculate totals
  const totalBonuses = employees.reduce((sum, emp) => {
    const state = rowStates[emp.id];
    if (!state) return sum;
    return sum + calculateBonus(state).bonusAmount;
  }, 0);

  // Team Lead bonus: PKR 5,000 per eligible employee (excluding team lead EM-4)
  const eligibleCount = employees.reduce((count, emp) => {
    if (emp.employeeId === "EM-4") return count; // Skip Izaan himself
    const state = rowStates[emp.id];
    if (!state) return count;
    return count + (calculateBonus(state).isEligible ? 1 : 0);
  }, 0);
  const teamLeadBonus = eligibleCount * 5000;

  const totalReviewBonuses = reviewBonuses.reduce((sum, rb) => sum + rb.amount, 0);

  // Generate year options
  const yearOptions = [];
  for (let y = currentYear - 1; y <= currentYear + 1; y++) {
    yearOptions.push(y);
  }

  return (
    <div className="space-y-6">
      {/* AI Fetching Overlay */}
      {fetchingProfits && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-card rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4 border">
            <div className="relative">
              <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                <Cloud className="size-8 text-primary animate-bounce" />
              </div>
              <div className="absolute -top-1 -right-1 size-5 bg-green-500 rounded-full animate-ping" />
            </div>
            <h3 className="text-lg font-bold text-center">AI is Fetching Details</h3>
            <p className="text-sm text-muted-foreground text-center">
              Pulling latest profit data from Google Sheets for all employees...
            </p>
            <div className="flex gap-1">
              <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}

      {/* Month/Year Selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Month:</span>
              <Select value={month} onValueChange={(v) => v && setMonth(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Year:</span>
              <Select value={year} onValueChange={(v) => v && setYear(v)}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleMonthChange}>
              Load
            </Button>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={handleFetchProfits}
                disabled={fetchingProfits}
                className="gap-2"
              >
                {fetchingProfits ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Cloud className="size-3.5" />
                )}
                {fetchingProfits ? "Fetching..." : "Fetch Profits from Sheets"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bonus Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="size-4" />
            Etsy Employee Bonus Eligibility - {MONTHS[parseInt(month) - 1]} {year}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[150px]">Employee</TableHead>
                  <TableHead className="text-center min-w-[80px]">Daily Listings</TableHead>
                  <TableHead className="text-center min-w-[80px]">Orders Processed</TableHead>
                  <TableHead className="text-center min-w-[80px]">Messages Cleared</TableHead>
                  <TableHead className="text-center min-w-[80px]">Zero Wrong Orders</TableHead>
                  <TableHead className="text-center min-w-[100px]">Listings Removed</TableHead>
                  <TableHead className="text-center min-w-[80px]">Stores Above 4*</TableHead>
                  <TableHead className="text-center min-w-[120px]">Profit ($)</TableHead>
                  <TableHead className="text-center min-w-[100px]">Eligible</TableHead>
                  <TableHead className="text-center min-w-[100px]">Bonus (PKR)</TableHead>
                  <TableHead className="text-center min-w-[80px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      No Etsy department employees found.
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((emp) => {
                    const state = rowStates[emp.id];
                    if (!state) return null;

                    const { isEligible, bonusAmount, profitTier } = calculateBonus(state);
                    const isSaving = savingRows[emp.id] || false;

                    return (
                      <TableRow key={emp.id}>
                        <TableCell className="text-sm font-medium">
                          {emp.firstName} {emp.lastName}
                          <div className="text-xs text-muted-foreground">{emp.employeeId}</div>
                        </TableCell>

                        {/* Daily Listings */}
                        <TableCell className="text-center">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={state.dailyListingsComplete}
                              onCheckedChange={(v) => updateRow(emp.id, "dailyListingsComplete", !!v)}
                            />
                          </div>
                        </TableCell>

                        {/* Orders Processed */}
                        <TableCell className="text-center">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={state.ordersProcessedSameDay}
                              onCheckedChange={(v) => updateRow(emp.id, "ordersProcessedSameDay", !!v)}
                            />
                          </div>
                        </TableCell>

                        {/* Messages Cleared */}
                        <TableCell className="text-center">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={state.messagesCleared}
                              onCheckedChange={(v) => updateRow(emp.id, "messagesCleared", !!v)}
                            />
                          </div>
                        </TableCell>

                        {/* Zero Wrong Orders */}
                        <TableCell className="text-center">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={state.zeroWrongOrders}
                              onCheckedChange={(v) => updateRow(emp.id, "zeroWrongOrders", !!v)}
                            />
                          </div>
                        </TableCell>

                        {/* Listings Removed (number) */}
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={0}
                            className="w-16 mx-auto text-center"
                            value={state.listingsRemovedCount}
                            onChange={(e) =>
                              updateRow(emp.id, "listingsRemovedCount", parseInt(e.target.value) || 0)
                            }
                          />
                          {state.listingsRemovedCount > 3 && (
                            <span className="text-xs text-red-500">Max 3!</span>
                          )}
                        </TableCell>

                        {/* Stores Above 4 Stars */}
                        <TableCell className="text-center">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={state.allStoresAbove4Stars}
                              onCheckedChange={(v) => updateRow(emp.id, "allStoresAbove4Stars", !!v)}
                            />
                          </div>
                        </TableCell>

                        {/* Profit */}
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-muted-foreground text-xs">$</span>
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              className="w-24 text-center"
                              value={state.totalProfit}
                              onChange={(e) =>
                                updateRow(emp.id, "totalProfit", parseFloat(e.target.value) || 0)
                              }
                            />
                          </div>
                          {/* Profit tier indicator */}
                          <div className="mt-1">
                            {state.totalProfit < 1000 && state.totalProfit > 0 && (
                              <span className="text-xs text-red-500 font-medium">
                                Need ${(1000 - state.totalProfit).toLocaleString()} more
                              </span>
                            )}
                            {state.totalProfit >= 1000 && (() => {
                              const tiers = Math.floor(state.totalProfit / 500);
                              const tierUSD = tiers * 500;
                              const bonusPKR = tiers * 5000;
                              const nextTier = (tiers + 1) * 500;
                              const gap = nextTier - state.totalProfit;
                              return (
                                <div>
                                  <span className="text-xs text-green-600 font-semibold">
                                    ${tierUSD.toLocaleString()} tier → PKR {bonusPKR.toLocaleString()}
                                  </span>
                                  <br />
                                  <span className="text-xs text-muted-foreground">
                                    ${gap.toLocaleString()} to next tier (PKR {((tiers + 1) * 5000).toLocaleString()})
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        </TableCell>

                        {/* Eligible Badge */}
                        <TableCell className="text-center">
                          {isEligible ? (
                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                              Eligible
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-100">
                              Not Eligible
                            </Badge>
                          )}
                        </TableCell>

                        {/* Bonus Amount */}
                        <TableCell className="text-center font-medium">
                          {bonusAmount > 0 ? (
                            <span className="text-green-600">PKR {bonusAmount.toLocaleString()}</span>
                          ) : (
                            <span className="text-red-500">PKR 0</span>
                          )}
                        </TableCell>

                        {/* Save Button */}
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSave(emp.id)}
                            disabled={isSaving}
                          >
                            <Save className="size-3.5 mr-1" />
                            {isSaving ? "..." : "Save"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Team Lead Bonus Card */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Team Lead Bonus — Izaan Kashif (EM-4)</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                PKR 5,000 × {eligibleCount} eligible employee{eligibleCount !== 1 ? "s" : ""} = <span className="font-bold text-lg">PKR {teamLeadBonus.toLocaleString()}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">PKR {teamLeadBonus.toLocaleString()}</p>
              <p className="text-xs text-amber-600 dark:text-amber-400">+ Basic Salary</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-green-100">
                <DollarSign className="size-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Performance Bonuses</p>
                <p className="text-xl font-bold text-green-600">PKR {totalBonuses.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-amber-100">
                <Trophy className="size-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Team Lead Bonus</p>
                <p className="text-xl font-bold text-amber-600">PKR {teamLeadBonus.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100">
                <Trophy className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Review Bonuses</p>
                <p className="text-xl font-bold text-blue-600">PKR {totalReviewBonuses.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100">
                <Users className="size-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Grand Total</p>
                <p className="text-xl font-bold text-purple-600">
                  PKR {(totalBonuses + teamLeadBonus + totalReviewBonuses).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
