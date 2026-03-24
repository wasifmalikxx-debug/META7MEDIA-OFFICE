"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

interface FinesViewProps {
  fines: any[];
  employees: any[];
  isAdmin: boolean;
}

export function FinesView({ fines, employees, isAdmin }: FinesViewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    userId: "",
    type: "LATE_ARRIVAL",
    amount: 0,
    reason: "",
    date: new Date().toISOString().split("T")[0],
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/fines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Fine added!");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const total = fines.reduce((s, f) => s + f.amount, 0);

  const typeLabels: Record<string, string> = {
    LATE_ARRIVAL: "Late",
    EARLY_DEPARTURE: "Early Leave",
    ABSENT_WITHOUT_LEAVE: "Absent",
    POLICY_VIOLATION: "Policy",
    OTHER: "Other",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Total fines this month:{" "}
          <span className="font-bold text-red-600">PKR {total.toLocaleString()}</span>
        </p>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" variant="destructive" />}>
                <Plus className="size-4 mr-1" /> Add Fine
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Fine</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select value={form.userId} onValueChange={(v) => v && setForm({ ...form, userId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select employee..." /></SelectTrigger>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.firstName} {emp.lastName} ({emp.employeeId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LATE_ARRIVAL">Late Arrival</SelectItem>
                        <SelectItem value="EARLY_DEPARTURE">Early Departure</SelectItem>
                        <SelectItem value="ABSENT_WITHOUT_LEAVE">Absent Without Leave</SelectItem>
                        <SelectItem value="POLICY_VIOLATION">Policy Violation</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount (PKR)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Textarea
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Reason for fine..."
                    required
                  />
                </div>
                <Button type="submit" variant="destructive" className="w-full" disabled={loading}>
                  {loading ? "Adding..." : "Add Fine"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Issued By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No fines this month.
                  </TableCell>
                </TableRow>
              ) : (
                fines.map((fine) => (
                  <TableRow key={fine.id}>
                    <TableCell className="text-sm">
                      {fine.user.firstName} {fine.user.lastName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive" className="text-xs">
                        {typeLabels[fine.type] || fine.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium text-red-600">
                      PKR {fine.amount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {fine.reason}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(fine.date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {fine.issuedBy.firstName} {fine.issuedBy.lastName}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
