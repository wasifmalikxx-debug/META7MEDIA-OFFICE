"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Building2, Users } from "lucide-react";

interface DepartmentsViewProps {
  departments: any[];
}

export function DepartmentsView({ departments }: DepartmentsViewProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Department added!");
      setAddOpen(false);
      setName("");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/departments/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Department updated!");
      setEditOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, deptName: string) {
    if (!confirm(`Delete department "${deptName}"? Employees will be unassigned.`)) return;
    try {
      const res = await fetch(`/api/departments/${id}`, { method: "DELETE" });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      toast.success("Department deleted!");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const totalEmployees = departments.reduce((s: number, d: any) => s + (d._count?.users || 0), 0);
  const deptColors: Record<string, string> = {
    Etsy: "from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800 border-emerald-200 dark:border-emerald-800",
    Facebook: "from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800 border-blue-200 dark:border-blue-800",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
            <Building2 className="size-3.5 text-slate-500" />
            <span className="text-xs font-medium">{departments.length} departments</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
            <Users className="size-3.5 text-slate-500" />
            <span className="text-xs font-medium">{totalEmployees} employees</span>
          </div>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" className="gap-1.5 rounded-lg" />}>
            <Plus className="size-4" /> New Department
          </DialogTrigger>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle className="text-lg">Create Department</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Department Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Development, Marketing, Sales..." required className="h-10" />
              </div>
              <Button type="submit" className="w-full h-10 gap-2 rounded-lg" disabled={loading}>
                <Building2 className="size-4" />
                {loading ? "Creating..." : "Create Department"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-lg">Edit Department</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Department Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required className="h-10" />
            </div>
            <Button type="submit" className="w-full h-10 rounded-lg" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Department Cards */}
      {departments.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="size-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Building2 className="size-7 text-muted-foreground/40" />
            </div>
            <p className="text-muted-foreground font-semibold">No Departments</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create your first department to organize employees</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((dept: any) => {
            const colorClass = deptColors[dept.name] || "from-slate-50 to-white dark:from-slate-800 dark:to-slate-800 border-slate-200 dark:border-slate-700";
            return (
              <Card key={dept.id} className={`border-0 shadow-sm overflow-hidden hover:shadow-md transition-shadow bg-gradient-to-br ${colorClass}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-11 rounded-xl bg-white/80 dark:bg-black/20 shadow-sm flex items-center justify-center">
                        <Building2 className="size-5 text-muted-foreground" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">{dept.name}</h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Users className="size-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{dept._count?.users || 0} employees</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="size-8 p-0" onClick={() => { setEditId(dept.id); setEditName(dept.name); setEditOpen(true); }}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="size-8 p-0 text-rose-400 hover:text-rose-600" onClick={() => handleDelete(dept.id, dept.name)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
