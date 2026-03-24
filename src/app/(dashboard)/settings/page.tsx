"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus } from "lucide-react";

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
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newHoliday),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHolidays([...holidays, data].sort((a, b) => a.date.localeCompare(b.date)));
      setNewHoliday({ name: "", date: "" });
      toast.success("Holiday added");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAddingHoliday(false);
    }
  }

  async function deleteHoliday(id: string) {
    if (!confirm("Remove this holiday?")) return;
    try {
      await fetch(`/api/holidays/${id}`, { method: "DELETE" });
      setHolidays(holidays.filter((h) => h.id !== id));
      toast.success("Holiday removed");
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success("Settings saved!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4">Loading settings...</div>;

  function update(field: string, value: any) {
    setSettings((s: any) => ({ ...s, [field]: value }));
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Office Settings" description="Configure office rules and policies" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work Hours</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={settings.workStartTime}
                  onChange={(e) => update("workStartTime", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={settings.workEndTime}
                  onChange={(e) => update("workEndTime", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Grace Period (minutes)</Label>
                <Input
                  type="number"
                  value={settings.graceMinutes}
                  onChange={(e) => update("graceMinutes", parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Half Day Threshold (minutes)</Label>
                <Input
                  type="number"
                  value={settings.halfDayThresholdMin}
                  onChange={(e) => update("halfDayThresholdMin", parseInt(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Working Days Per Week</Label>
              <Input
                type="number"
                value={settings.workingDaysPerWeek}
                onChange={(e) => update("workingDaysPerWeek", parseInt(e.target.value))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Break Timings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Break Start Time</Label>
                <Input
                  type="time"
                  value={settings.breakStartTime}
                  onChange={(e) => update("breakStartTime", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Break End Time</Label>
                <Input
                  type="time"
                  value={settings.breakEndTime}
                  onChange={(e) => update("breakEndTime", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Break Duration (min)</Label>
                <Input
                  type="number"
                  value={settings.breakDurationMin}
                  onChange={(e) => update("breakDurationMin", parseInt(e.target.value))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Break Grace Period (min)</Label>
                <Input
                  type="number"
                  value={settings.breakGraceMinutes}
                  onChange={(e) => update("breakGraceMinutes", parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Extra minutes allowed after break ends before fine applies
                </p>
              </div>
              <div className="space-y-2">
                <Label>Late From Break Fine (PKR)</Label>
                <Input
                  type="number"
                  value={settings.breakLateFineAmt}
                  onChange={(e) => update("breakLateFineAmt", parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Auto-fine if employee returns after break end + grace
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Late Fine Tiers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tier 1: After (min)</Label>
                <Input
                  type="number"
                  value={settings.lateFineTier1Min}
                  onChange={(e) => update("lateFineTier1Min", parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tier 1: Amount (PKR)</Label>
                <Input
                  type="number"
                  value={settings.lateFineTier1Amt}
                  onChange={(e) => update("lateFineTier1Amt", parseFloat(e.target.value))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tier 2: After (min)</Label>
                <Input
                  type="number"
                  value={settings.lateFineTier2Min}
                  onChange={(e) => update("lateFineTier2Min", parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tier 2: Amount (PKR)</Label>
                <Input
                  type="number"
                  value={settings.lateFineTier2Amt}
                  onChange={(e) => update("lateFineTier2Amt", parseFloat(e.target.value))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tier 3: After (min)</Label>
                <Input
                  type="number"
                  value={settings.lateFineTier3Min}
                  onChange={(e) => update("lateFineTier3Min", parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tier 3: Amount (PKR)</Label>
                <Input
                  type="number"
                  value={settings.lateFineTier3Amt}
                  onChange={(e) => update("lateFineTier3Amt", parseFloat(e.target.value))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leave Policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Paid Leaves Per Month</Label>
              <Input
                type="number"
                min="0"
                value={settings.paidLeavesPerMonth}
                onChange={(e) => update("paidLeavesPerMonth", parseInt(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Auto-applied to first absence(s) each month. No application needed from employee.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">IP Restriction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="ipRestriction"
                checked={settings.ipRestrictionEnabled}
                onCheckedChange={(v) => update("ipRestrictionEnabled", !!v)}
              />
              <Label htmlFor="ipRestriction">Enable IP restriction for check-in</Label>
            </div>
            <div className="space-y-2">
              <Label>Allowed IPs (comma-separated)</Label>
              <Input
                value={settings.allowedIps}
                onChange={(e) => update("allowedIps", e.target.value)}
                placeholder="192.168.1.1, 10.0.0.1"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Official Holidays */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Official Holidays / Govt Off Days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Employees will not be marked absent on these days. No salary deduction.
          </p>
          <div className="flex gap-3 items-end">
            <div className="space-y-1.5 flex-1">
              <Label className="text-xs">Holiday Name</Label>
              <Input
                value={newHoliday.name}
                onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                placeholder="e.g. Eid ul Fitr, 23 March, Independence Day"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={newHoliday.date}
                onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
              />
            </div>
            <Button size="sm" onClick={addHoliday} disabled={addingHoliday}>
              <Plus className="size-4 mr-1" /> Add
            </Button>
          </div>

          {holidays.length > 0 ? (
            <div className="border rounded-lg divide-y">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm font-medium">{h.name}</span>
                    <span className="text-xs text-muted-foreground ml-3">
                      {new Date(h.date).toLocaleDateString("en-PK", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500 hover:text-red-700"
                    onClick={() => deleteHoliday(h.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No holidays added yet
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
