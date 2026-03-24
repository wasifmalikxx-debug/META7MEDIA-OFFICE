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

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setLoading(false);
      });
  }, []);

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
            <CardTitle className="text-base">Leave Quotas (Yearly)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Casual Leave</Label>
                <Input
                  type="number"
                  value={settings.casualLeaveQuota}
                  onChange={(e) => update("casualLeaveQuota", parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Sick Leave</Label>
                <Input
                  type="number"
                  value={settings.sickLeaveQuota}
                  onChange={(e) => update("sickLeaveQuota", parseInt(e.target.value))}
                />
              </div>
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

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
