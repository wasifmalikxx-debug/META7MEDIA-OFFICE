"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Save, User } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BankDetailsCard } from "@/components/profile/bank-details-card";
import { cn } from "@/lib/utils";

/**
 * My Profile — one page for every role.
 *
 * Replaces the pair it grew out of (an editor for the CEO, a plain read-only
 * card for everybody else) which had drifted into two different visual
 * languages. Both roles now get the same cards in the same order; only the
 * fields' editability differs, and that mirrors what the app already allowed:
 *
 *   CEO       — edits name, email and both phones (PUT /api/profile).
 *   Everyone  — reads those, and edits bank details (PATCH /api/profile/…).
 *
 * That split is deliberately UNCHANGED. Letting staff edit their own phone
 * would move the number the WhatsApp reports go to, and their own email is
 * their login — both are the CEO's call, not a redesign's.
 *
 * The read-only fields are laid out in the same slots as the inputs they stand
 * in for, so the two variants of the page have an identical silhouette.
 */

export type ProfileUser = {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phone2: string;
  role: string;
  status: string;
  designation: string | null;
  department: string | null;
  joiningDate: string | null;
  isCeo: boolean;
  bankName: string | null;
  accountNumber: string | null;
  accountTitle: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "CEO",
  HR_ADMIN: "HR Admin",
  PARTNER: "Partner",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

const STATUS_LABEL: Record<string, string> = {
  HIRED: "Hired",
  PROBATION: "Probation",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Neutral chip. The theme is greyscale — no coloured role pills here. */
function Chip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground",
        mono && "font-mono tracking-wide",
      )}
    >
      {children}
    </span>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="text-[13px] font-medium text-muted-foreground">
      {children}
    </Label>
  );
}

/** Read-only stand-in for an Input. Same 32px box, so both role variants of a
 *  card line up row for row. */
function ReadOnlyField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <p className="flex h-8 items-center truncate text-sm text-foreground">
        {value || <span className="text-muted-foreground">Not set</span>}
      </p>
    </div>
  );
}

function EditableField({
  id,
  label,
  hint,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ProfileView({ user }: { user: ProfileUser }) {
  const router = useRouter();
  const canEdit = user.isCeo;

  const initial = React.useMemo(
    () => ({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      phone2: user.phone2,
    }),
    [user.firstName, user.lastName, user.email, user.phone, user.phone2],
  );

  const [form, setForm] = React.useState(initial);
  // The baseline the dirty check compares against. Bumped on a successful
  // save, or the button would stay lit after the change had landed.
  const [saved, setSaved] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  const set = (key: keyof typeof form) => (v: string) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  const dirty = (Object.keys(saved) as (keyof typeof saved)[]).some(
    (k) => form[k].trim() !== saved[k].trim(),
  );

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
      toast.success("Profile updated");
      setSaved(form);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const fullName = `${form.firstName} ${form.lastName}`.trim() || "—";
  const roleLabel = ROLE_LABEL[user.role] ?? titleCase(user.role);
  const statusLabel = STATUS_LABEL[user.status] ?? titleCase(user.status);
  const joined = user.joiningDate ? format(new Date(user.joiningDate), "d MMM yyyy") : null;
  const meta = [user.designation, joined && `Joined ${joined}`].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Profile"
        description="Your account details and contact information."
      >
        {canEdit && (
          <Button onClick={handleSave} disabled={saving || !dirty}>
            <Save />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        )}
      </PageHeader>

      {/* Identity — the same summary for every role. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* flex-basis 15rem, not flex-1: with flex-1 the name block just
              shrank on a phone and the chips stayed on the same line, so
              "Wasif Malik" truncated to "Wasi…". A basis forces the chips to
              wrap to their own row instead. */}
          <div className="flex min-w-0 flex-[1_1_15rem] items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
              <User className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{fullName}</p>
              <p className="mt-0.5 truncate text-[13px] leading-tight text-muted-foreground">
                {form.email || "—"}
              </p>
            {/* Facts nobody can edit here. They sat in a bordered strip under
                the name fields, which left the Contact card beside it visibly
                short; as a meta line they cost no height and both form cards
                come out the same size. */}
              {meta.length > 0 && (
                <p className="mt-1 truncate text-xs leading-tight text-muted-foreground/80">
                  {meta.join(" · ")}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip mono>{user.employeeId}</Chip>
            <Chip>{roleLabel}</Chip>
            {user.department && <Chip>{user.department}</Chip>}
            <Chip>{statusLabel}</Chip>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canEdit ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <EditableField
                    id="firstName"
                    label="First name"
                    value={form.firstName}
                    onChange={set("firstName")}
                  />
                  <EditableField
                    id="lastName"
                    label="Last name"
                    value={form.lastName}
                    onChange={set("lastName")}
                  />
                </div>
                <EditableField
                  id="email"
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  hint="Also the address you sign in with."
                />
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReadOnlyField label="First name" value={user.firstName} />
                  <ReadOnlyField label="Last name" value={user.lastName} />
                </div>
                <ReadOnlyField label="Email" value={user.email} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canEdit ? (
              <>
                <EditableField
                  id="phone"
                  label="Primary phone"
                  placeholder="+923001234567"
                  value={form.phone}
                  onChange={set("phone")}
                  hint="Where WhatsApp notifications are sent."
                />
                <EditableField
                  id="phone2"
                  label="Secondary phone"
                  placeholder="+923001234567"
                  value={form.phone2}
                  onChange={set("phone2")}
                  hint="Backup contact number."
                />
              </>
            ) : (
              <>
                <ReadOnlyField label="Primary phone" value={user.phone} />
                <ReadOnlyField label="Secondary phone" value={user.phone2} />
                <p className="text-xs text-muted-foreground">
                  Ask the CEO to update these — the primary number is where your WhatsApp
                  notifications are sent.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payout details. The CEO has no bank row in payroll, so this stays
          off his page exactly as before. */}
      {!user.isCeo && (
        <BankDetailsCard
          bankName={user.bankName}
          accountNumber={user.accountNumber}
          accountTitle={user.accountTitle}
        />
      )}
    </div>
  );
}
