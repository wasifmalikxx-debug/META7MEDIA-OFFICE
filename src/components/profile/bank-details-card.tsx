"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Pencil, Save, X } from "lucide-react";

interface BankDetailsCardProps {
  userId: string;
  bankName: string | null;
  accountNumber: string | null;
  accountTitle: string | null;
}

export function BankDetailsCard({
  userId,
  bankName,
  accountNumber,
  accountTitle,
}: BankDetailsCardProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    bankName: bankName || "",
    accountNumber: accountNumber || "",
    accountTitle: accountTitle || "",
  });

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/bank-details", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Bank details updated!");
      setEditing(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Bank Details</CardTitle>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5 mr-1" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Bank Name</Label>
              <Input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                placeholder="e.g. Meezan Bank"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Account Number</Label>
              <Input
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                placeholder="e.g. 00300110239903"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Account Title</Label>
              <Input
                value={form.accountTitle}
                onChange={(e) => setForm({ ...form, accountTitle: e.target.value })}
                placeholder="e.g. Muhammad Sufyan"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="size-3.5 mr-1" />
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                <X className="size-3.5 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Bank</span>
              <span className="font-medium">{form.bankName || "Not set"}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Account No.</span>
              <span className="font-medium font-mono">{form.accountNumber || "Not set"}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Account Title</span>
              <span className="font-medium">{form.accountTitle || "Not set"}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
