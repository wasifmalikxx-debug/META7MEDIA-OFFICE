"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil, Save, X } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Bank details — the one thing staff can edit about themselves.
 *
 * The explicit Edit → Save/Cancel gate is kept on purpose: this is the account
 * payroll pays into, so it should take a deliberate click to open, not stray
 * typing. Only the styling changed in the Aug 2026 redesign.
 *
 * Note there is no `userId` prop. The PATCH route writes to `session.user.id`
 * and always has; the old prop was passed in but never read, which made it
 * look like the caller could target another user.
 */

interface BankDetailsCardProps {
  bankName: string | null;
  accountNumber: string | null;
  accountTitle: string | null;
}

const FIELDS = [
  { key: "bankName", label: "Bank name", placeholder: "e.g. Meezan Bank" },
  { key: "accountNumber", label: "Account number", placeholder: "e.g. 00300110239903", mono: true },
  { key: "accountTitle", label: "Account title", placeholder: "e.g. Muhammad Sufyan" },
] as const;

export function BankDetailsCard({
  bankName,
  accountNumber,
  accountTitle,
}: BankDetailsCardProps) {
  const initial = React.useMemo(
    () => ({
      bankName: bankName || "",
      accountNumber: accountNumber || "",
      accountTitle: accountTitle || "",
    }),
    [bankName, accountNumber, accountTitle],
  );

  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState(initial);
  // What's actually stored. Cancel restores this, so a discarded edit can't
  // leave the read view showing a value that was never saved.
  const [saved, setSaved] = React.useState(initial);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/bank-details", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success("Bank details updated");
      setSaved(form);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setForm(saved);
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Bank Details</CardTitle>
        <CardDescription className="text-[13px]">
          The account your salary is paid into.
        </CardDescription>
        {!editing && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label
              htmlFor={`bank-${field.key}`}
              className="text-[13px] font-medium text-muted-foreground"
            >
              {field.label}
            </Label>
            {editing ? (
              <Input
                id={`bank-${field.key}`}
                value={form[field.key]}
                placeholder={field.placeholder}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              />
            ) : (
              // Same 32px box as the Input it replaces, so toggling Edit
              // doesn't change the card's height.
              <p
                className={`flex h-8 items-center truncate text-sm ${
                  "mono" in field && field.mono ? "font-mono" : ""
                }`}
              >
                {saved[field.key] || <span className="text-muted-foreground">Not set</span>}
              </p>
            )}
          </div>
        ))}
      </CardContent>

      {editing && (
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            <X />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save />
            {saving ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
