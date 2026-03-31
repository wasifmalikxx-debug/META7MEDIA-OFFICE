"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Trash2, Plus, Clock, Coffee, AlertTriangle, CalendarOff,
  Shield, Save, Calendar, Banknote,
} from "lucide-react";

export const dynamic = "force-dynamic";

function SectionCard({ icon: Icon, title, color, children }: { icon: any; title: string; color: string; children: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <div className={`flex items-center gap-3 px-5 py-3 border-b ${color}`}>
        <div className="rounded-lg bg-white/80 dark:bg-black/20 p-1.5">
          <Icon className="size-3.5" />
        </div>
        <h3 className="font-bold text-xs">{title}</h3>
      </div>
      <CardContent className="p-4 space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<any>(null);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [newHoliday, setNewHoliday] = useState({ name: "", date: "" });
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/holidays").then((r) => r.json()),
    ]).then(([settingsData, holidaysData]) => {
      setSettings(settingsData);
      setHolidays(holidaysData);
      setLoading(false);
    });
  }, []);

  async function addHoliday() {
    if (!newHoliday.name || !newHoliday.date) return;
    setAddingHoliday(true);
    try {
      const res = await fetch("/api/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newHoliday) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHolidays([...holidays, data].sort((a, b) => a.date.localeCompare(b.date)));
      setNewHoliday({ name: "", date: "" });
      toast.success("Holiday added");
    } catch (err: any) { toast.error(err.message); }
    finally { setAddingHoliday(false); }
  }

  async function deleteHoliday(id: string) {
    if (!confirm("Remove this holiday?")) return;
    try { await fetch(`/api/holidays/${id}`, { method: "DELETE" }); setHolidays(holidays.filter((h) => h.id !== id)); toast.success("Holiday removed"); }
    catch (err: any) { toast.error(err.message); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      toast.success("Settings saved!");
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;

  function update(field: string, value: any) {
    setSettings((s: any) => ({ ...s, [field]: value }));
  }

  function FieldRow({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">{label}</Label>
        {children}
        {helper && <p className="text-[10px] text-muted-foreground">{helper}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Office Settings" description="Configure office rules, timings, fines, and policies" />
        <Button onClick={handleSave} disabled={saving} className="gap-2 rounded-lg">
          <Save className="size-4" />
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Work Hours */}
        <SectionCard icon={Clock} title="Work Hours" color="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Start Time">
              <Input type="time" value={settings.workStartTime} onChange={(e) => update("workStartTime", e.target.value)} className="h-9" />
            </FieldRow>
            <FieldRow label="End Time">
              <Input type="time" value={settings.workEndTime} onChange={(e) => update("workEndTime", e.target.value)} className="h-9" />
            </FieldRow>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FieldRow label="Grace (min)" helper="Before late fine">
              <Input type="number" value={settings.graceMinutes} onChange={(e) => update("graceMinutes", parseInt(e.target.value))} className="h-9" />
            </FieldRow>
            <FieldRow label="Half Day (min)" helper="Minimum for full day">
              <Input type="number" value={settings.halfDayThresholdMin} onChange={(e) => update("halfDayThresholdMin", parseInt(e.target.value))} className="h-9" />
            </FieldRow>
            <FieldRow label="Days / Week">
              <Input type="number" value={settings.workingDaysPerWeek} onChange={(e) => update("workingDaysPerWeek", parseInt(e.target.value))} className="h-9" />
            </FieldRow>
          </div>
        </SectionCard>

        {/* Break Timings */}
        <SectionCard icon={Coffee} title="Break Timings" color="bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400">
          <div className="grid grid-cols-3 gap-3">
            <FieldRow label="Start Time">
              <Input type="time" value={settings.breakStartTime} onChange={(e) => update("breakStartTime", e.target.value)} className="h-9" />
            </FieldRow>
            <FieldRow label="End Time">
              <Input type="time" value={settings.breakEndTime} onChange={(e) => update("breakEndTime", e.target.value)} className="h-9" />
            </FieldRow>
            <FieldRow label="Duration (min)">
              <Input type="number" value={settings.breakDurationMin} onChange={(e) => update("breakDurationMin", parseInt(e.target.value))} className="h-9" />
            </FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Grace Period (min)" helper="Extra minutes after break ends">
              <Input type="number" value={settings.breakGraceMinutes} onChange={(e) => update("breakGraceMinutes", parseInt(e.target.value))} className="h-9" />
            </FieldRow>
            <FieldRow label="Late / Skip Fine (PKR)" helper="Auto-fine for late return or skip">
              <Input type="number" value={settings.breakLateFineAmt} onChange={(e) => update("breakLateFineAmt", parseFloat(e.target.value))} className="h-9" />
            </FieldRow>
          </div>
        </SectionCard>

        {/* Friday Break */}
        <SectionCard icon={Calendar} title="Friday Break (Jummah)" color="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Friday Start">
              <Input type="time" value={settings.fridayBreakStartTime} onChange={(e) => update("fridayBreakStartTime", e.target.value)} className="h-9" />
            </FieldRow>
            <FieldRow label="Friday End">
              <Input type="time" value={settings.fridayBreakEndTime} onChange={(e) => update("fridayBreakEndTime", e.target.value)} className="h-9" />
            </FieldRow>
          </div>
          <p className="text-[10px] text-muted-foreground">Longer break for Jummah prayers. Same grace and fine rules apply.</p>
        </SectionCard>

        {/* Late Fine Tiers */}
        <SectionCard icon={AlertTriangle} title="Late Arrival Fines" color="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
          {[
            { label: "Tier 1", minField: "lateFineTier1Min", amtField: "lateFineTier1Amt" },
            { label: "Tier 2", minField: "lateFineTier2Min", amtField: "lateFineTier2Amt" },
            { label: "Tier 3", minField: "lateFineTier3Min", amtField: "lateFineTier3Amt" },
          ].map((tier) => (
            <div key={tier.label} className="grid grid-cols-2 gap-3">
              <FieldRow label={`${tier.label}: After (min)`}>
                <Input type="number" value={settings[tier.minField]} onChange={(e) => update(tier.minField, parseInt(e.target.value))} className="h-9" />
              </FieldRow>
              <FieldRow label={`${tier.label}: Fine (PKR)`}>
                <Input type="number" value={settings[tier.amtField]} onChange={(e) => update(tier.amtField, parseFloat(e.target.value))} className="h-9" />
              </FieldRow>
            </div>
          ))}
        </SectionCard>

        {/* Auto Fines */}
        <SectionCard icon={Banknote} title="Auto Fines" color="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400">
          <FieldRow label="No Report Fine (PKR)" helper="Applied when auto-checkout without daily report">
            <Input type="number" value={settings.noReportFineAmt} onChange={(e) => update("noReportFineAmt", parseFloat(e.target.value))} className="h-9" />
          </FieldRow>
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Break Skip Fine</span>
              <span className="font-semibold">PKR {settings.breakLateFineAmt}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Same as break late fine — applied if break not logged</p>
          </div>
        </SectionCard>

        {/* Leave Policy */}
        <SectionCard icon={CalendarOff} title="Leave Policy" color="bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400">
          <FieldRow label="Paid Leaves Per Month" helper="Auto-applied to first absence(s). Unused leaves roll over.">
            <Input type="number" min="0" value={settings.paidLeavesPerMonth} onChange={(e) => update("paidLeavesPerMonth", parseInt(e.target.value))} className="h-9" />
          </FieldRow>
        </SectionCard>

        {/* IP Restriction */}
        <SectionCard icon={Shield} title="IP Restriction" color="bg-slate-100 dark:bg-slate-800/50 text-slate-700 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Checkbox id="ipRestriction" checked={settings.ipRestrictionEnabled} onCheckedChange={(v) => update("ipRestrictionEnabled", !!v)} />
            <Label htmlFor="ipRestriction" className="text-xs">Enable IP restriction for check-in</Label>
          </div>
          <FieldRow label="Allowed IPs" helper="Comma-separated IP addresses">
            <Input value={settings.allowedIps} onChange={(e) => update("allowedIps", e.target.value)} placeholder="192.168.1.1, 10.0.0.1" className="h-9" />
          </FieldRow>
        </SectionCard>
      </div>

      {/* Official Holidays */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
          <div className="rounded-lg bg-white/80 dark:bg-black/20 p-1.5">
            <CalendarOff className="size-3.5" />
          </div>
          <h3 className="font-bold text-xs">Official Holidays / Govt Off Days</h3>
          <Badge variant="outline" className="text-[9px] h-5 ml-auto">{holidays.length} holidays</Badge>
        </div>
        <CardContent className="p-4 space-y-4">
          <p className="text-[10px] text-muted-foreground">
            No attendance, no fines, no salary deduction on these days. Treated like Sundays.
          </p>
          <div className="flex gap-3 items-end">
            <div className="space-y-1.5 flex-1">
              <Label className="text-xs font-semibold">Holiday Name</Label>
              <Input value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} placeholder="e.g. Eid ul Fitr, 23 March" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Date</Label>
              <Input type="date" value={newHoliday.date} onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })} className="h-9" />
            </div>
            <Button size="sm" onClick={addHoliday} disabled={addingHoliday} className="h-9 gap-1.5 rounded-lg">
              <Plus className="size-3.5" /> Add
            </Button>
          </div>

          {holidays.length > 0 ? (
            <div className="rounded-lg border divide-y">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="size-7 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                      <CalendarOff className="size-3.5 text-orange-600" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold">{h.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">
                        {new Date(h.date).toLocaleDateString("en-PK", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="size-7 p-0 text-muted-foreground/40 hover:text-rose-600" onClick={() => deleteHoliday(h.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">No holidays added yet</p>
          )}
        </CardContent>
      </Card>

      {/* Bottom Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2 rounded-lg" size="lg">
          <Save className="size-4" />
          {saving ? "Saving..." : "Save All Settings"}
        </Button>
      </div>
    </div>
  );
}
