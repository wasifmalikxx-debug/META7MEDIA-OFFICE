"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Search, Pencil, Trash2 } from "lucide-react";

interface EmployeesViewProps {
  employees: any[];
  departments: any[];
}

const emptyForm = {
  employeeId: "",
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  phone: "",
  role: "EMPLOYEE",
  status: "HIRED",
  designation: "",
  departmentId: "",
  joiningDate: "",
  monthlySalary: 0,
  bankName: "",
  accountNumber: "",
  accountTitle: "",
};

export function EmployeesView({ employees, departments }: EmployeesViewProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState<any>(null);
  const [editId, setEditId] = useState("");

  const filtered = employees.filter(
    (emp) =>
      `${emp.firstName} ${emp.lastName} ${emp.employeeId} ${emp.email}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          departmentId: form.departmentId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Employee added!");
      setAddOpen(false);
      setForm(emptyForm);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(emp: any) {
    setEditId(emp.id);
    setEditForm({
      employeeId: emp.employeeId || "",
      email: emp.email,
      newPassword: "",
      firstName: emp.firstName,
      lastName: emp.lastName,
      phone: emp.phone || "",
      status: emp.status,
      designation: emp.designation || "",
      departmentId: emp.department?.id || "",
      joiningDate: emp.joiningDate ? new Date(emp.joiningDate).toISOString().split("T")[0] : "",
      monthlySalary: emp.salaryStructure?.monthlySalary || 0,
      bankName: emp.bankName || "",
      accountNumber: emp.accountNumber || "",
      accountTitle: emp.accountTitle || "",
    });
    setEditOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          departmentId: editForm.departmentId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Employee updated!");
      setEditOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete ${name}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Employee deleted");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, ID, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 rounded-lg"
          />
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" className="gap-1.5 rounded-lg" />}>
              <Plus className="size-4" /> Add Employee
          </DialogTrigger>
          <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg">Add New Employee</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-5">
              {/* Login Credentials */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Login Credentials</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Employee ID</Label>
                    <Input placeholder="EM-11 or SMM-8" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Email</Label>
                    <Input type="email" placeholder="name@meta7.media" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="h-9" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Password</Label>
                  <Input type="password" placeholder="Min 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} className="h-9" />
                </div>
              </div>

              <hr className="border-muted" />

              {/* Personal Info */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Personal Information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">First Name</Label>
                    <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Last Name</Label>
                    <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required className="h-9" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Phone <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XX-XXXXXXX" className="h-9" />
                </div>
              </div>

              <hr className="border-muted" />

              {/* Employment */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Employment Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Department</Label>
                    <Select value={form.departmentId} onValueChange={(v) => v && setForm({ ...form, departmentId: v })}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {departments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Status</Label>
                    <Select value={form.status} onValueChange={(v) => v && setForm({ ...form, status: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HIRED">Hired</SelectItem>
                        <SelectItem value="PROBATION">Probation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Joining Date</Label>
                    <Input type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} required className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Monthly Salary (PKR)</Label>
                    <Input type="number" min="0" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: parseFloat(e.target.value) || 0 })} required className="h-9" />
                  </div>
                </div>
              </div>

              <hr className="border-muted" />

              {/* Bank Details */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Bank Account <span className="font-normal text-muted-foreground">(optional)</span></p>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Bank Name</Label>
                  <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. Meezan Bank, JazzCash, Easypaisa" className="h-9" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Account Number</Label>
                    <Input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} placeholder="IBAN or account number" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Account Title</Label>
                    <Input value={form.accountTitle} onChange={(e) => setForm({ ...form, accountTitle: e.target.value })} placeholder="Account holder name" className="h-9" />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full h-10 gap-2 rounded-lg" disabled={loading}>
                <Plus className="size-4" />
                {loading ? "Adding..." : "Add Employee"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Employee Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>
          {editForm && (
            <form onSubmit={handleEdit} className="space-y-5">
              {/* Employee ID */}
              <div className="space-y-1.5">
                <Label className="text-xs">Employee ID</Label>
                <Input
                  value={editForm.employeeId}
                  onChange={(e) => setEditForm({ ...editForm, employeeId: e.target.value })}
                  placeholder="e.g. EM-1, SMM-1"
                />
              </div>

              {/* Login Credentials */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Login Credentials</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email</Label>
                    <Input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Reset Password</Label>
                    <Input
                      type="password"
                      placeholder="Leave blank to keep"
                      value={editForm.newPassword}
                      onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
                      minLength={6}
                    />
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              {/* Personal Info */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Personal Information</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">First Name</Label>
                    <Input
                      value={editForm.firstName}
                      onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Last Name</Label>
                    <Input
                      value={editForm.lastName}
                      onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    placeholder="e.g. 0300-1234567"
                  />
                </div>
              </div>

              <hr className="border-border" />

              {/* Employment */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Employment</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Department</Label>
                    <Select
                      value={editForm.departmentId}
                      onValueChange={(v) => v && setEditForm({ ...editForm, departmentId: v })}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {departments.find((d) => d.id === editForm.departmentId)?.name || "Select..."}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select
                      value={editForm.status}
                      onValueChange={(v) => v && setEditForm({ ...editForm, status: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HIRED">Hired</SelectItem>
                        <SelectItem value="PROBATION">Probation</SelectItem>
                        <SelectItem value="TERMINATED">Terminated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Joining Date</Label>
                    <Input
                      type="date"
                      value={editForm.joiningDate || ""}
                      onChange={(e) => setEditForm({ ...editForm, joiningDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Monthly Salary (PKR)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={editForm.monthlySalary}
                      onChange={(e) =>
                        setEditForm({ ...editForm, monthlySalary: parseFloat(e.target.value) || 0 })
                      }
                      required
                    />
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              {/* Bank Details */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bank Details</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Bank Name</Label>
                  <Input
                    value={editForm.bankName}
                    onChange={(e) => setEditForm({ ...editForm, bankName: e.target.value })}
                    placeholder="e.g. Meezan Bank"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Account Number</Label>
                    <Input
                      value={editForm.accountNumber}
                      onChange={(e) => setEditForm({ ...editForm, accountNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Account Title</Label>
                    <Input
                      value={editForm.accountTitle}
                      onChange={(e) => setEditForm({ ...editForm, accountTitle: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {(() => {
        const active = filtered.filter((e) => e.status === "HIRED" || e.status === "PROBATION");
        const inactive = filtered.filter((e) => e.status === "RESIGNED" || e.status === "TERMINATED");

        const grouped: Record<string, any[]> = {};
        active.forEach((emp) => {
          const dept = emp.department?.name || "Unassigned";
          if (!grouped[dept]) grouped[dept] = [];
          grouped[dept].push(emp);
        });
        const deptOrder = ["Etsy", "Facebook"];
        const sortedKeys = Object.keys(grouped).sort((a, b) => {
          const ai = deptOrder.indexOf(a);
          const bi = deptOrder.indexOf(b);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          return a.localeCompare(b);
        });

        const sections = sortedKeys.map((dept) => (
          <Card key={dept} className="border-0 shadow-sm overflow-hidden">
            <div className={`flex items-center justify-between px-5 py-2.5 border-b ${dept === "Etsy" ? "bg-emerald-50/40 dark:bg-emerald-950/10" : dept === "Facebook" ? "bg-blue-50/40 dark:bg-blue-950/10" : "bg-muted/20"}`}>
              <div className="flex items-center gap-2.5">
                <div className={`size-7 rounded-lg flex items-center justify-center ${dept === "Etsy" ? "bg-emerald-100 dark:bg-emerald-900/30" : dept === "Facebook" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-slate-100 dark:bg-slate-800"}`}>
                  <span className="text-[10px] font-bold">{dept[0]}</span>
                </div>
                <h3 className="text-xs font-bold">{dept} Team</h3>
              </div>
              <Badge variant="outline" className="text-[9px] h-5">{grouped[dept].length} members</Badge>
            </div>
            <CardContent className="p-0">
              <div className="divide-y divide-muted/30">
              {grouped[dept].map((emp) => (
                <div key={emp.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/20 transition-colors">
                  <div className="size-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
                    {emp.firstName[0]}{emp.lastName?.[0] || ""}
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-6 gap-3 items-center text-xs">
                    {/* Name + ID */}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold">{emp.firstName} {emp.lastName}</span>
                        <Badge className={`text-[7px] h-3.5 border-0 ${emp.status === "HIRED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"}`}>{emp.status}</Badge>
                      </div>
                      <span className="text-[9px] text-muted-foreground font-mono">{emp.employeeId}</span>
                    </div>
                    {/* Email */}
                    <div className="truncate text-muted-foreground">{emp.email}</div>
                    {/* Phone */}
                    <div className="font-mono text-muted-foreground">{emp.phone || "—"}</div>
                    {/* Salary */}
                    <div className="font-semibold">{emp.salaryStructure ? `PKR ${emp.salaryStructure.monthlySalary.toLocaleString()}` : "—"}</div>
                    {/* Joining */}
                    <div className="text-muted-foreground">{emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "—"}</div>
                    {/* Actions */}
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="size-7 p-0" onClick={() => openEdit(emp)}>
                        <Pencil className="size-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="size-7 p-0 text-rose-400 hover:text-rose-600" onClick={() => handleDelete(emp.id, `${emp.firstName} ${emp.lastName}`)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              </div>
            </CardContent>
          </Card>
        ));

        if (inactive.length > 0) {
          sections.push(
            <div key="inactive" className="space-y-3 mt-4">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                  <span className="text-xs font-bold text-rose-600">X</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-muted-foreground">Terminated / Resigned</h3>
                  <p className="text-[10px] text-muted-foreground">{inactive.length} former employees</p>
                </div>
              </div>
              <Card className="opacity-60 border-0 shadow-sm">
                <CardContent className="pt-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Joining</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inactive.map((emp) => (
                        <TableRow key={emp.id} className="text-muted-foreground">
                          <TableCell className="text-sm font-mono">{emp.employeeId}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">
                              {emp.firstName} {emp.lastName}
                            </div>
                            <div className="text-xs">{emp.email}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {emp.department?.name || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive" className="text-xs">
                              {emp.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {emp.joiningDate
                              ? new Date(emp.joiningDate).toLocaleDateString("en-PK", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEdit(emp)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-500 hover:text-red-700"
                                onClick={() =>
                                  handleDelete(emp.id, `${emp.firstName} ${emp.lastName}`)
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          );
        }

        return sections;
      })()}
    </div>
  );
}
