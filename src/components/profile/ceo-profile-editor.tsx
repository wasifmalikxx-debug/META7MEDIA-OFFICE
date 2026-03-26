"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, User, Phone, Mail, Shield } from "lucide-react";

interface CEOProfileEditorProps {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phone2: string;
  employeeId: string;
  role: string;
}

export function CEOProfileEditor({
  firstName: initFirst,
  lastName: initLast,
  email: initEmail,
  phone: initPhone,
  phone2: initPhone2,
  employeeId,
  role,
}: CEOProfileEditorProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: initFirst,
    lastName: initLast,
    email: initEmail,
    phone: initPhone,
    phone2: initPhone2,
  });

  async function handleSave() {
    if (!form.firstName.trim() || !form.email.trim()) {
      toast.error("Name and email are required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success("Profile updated successfully");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="size-4" />
            Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Employee ID</span>
            <span className="font-medium">{employeeId}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
              <Shield className="size-3 mr-1" />
              CEO
            </Badge>
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email" className="flex items-center gap-1">
                <Mail className="size-3" /> Email
              </Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="size-4" />
            Phone Numbers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="phone">Primary Phone</Label>
            <Input
              id="phone"
              placeholder="+923001234567"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used for WhatsApp notifications
            </p>
          </div>

          <div>
            <Label htmlFor="phone2">Secondary Phone</Label>
            <Input
              id="phone2"
              placeholder="+923001234567"
              value={form.phone2}
              onChange={(e) => setForm({ ...form, phone2: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Backup contact number
            </p>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full gap-2"
          >
            <Save className="size-4" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
