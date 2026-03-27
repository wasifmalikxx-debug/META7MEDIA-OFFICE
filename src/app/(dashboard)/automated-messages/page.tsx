"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MessageSquare,
  Send,
  CheckCircle2,
  XCircle,
  Pencil,
  X,
  Check,
  Loader2,
  Phone,
  Clock,
} from "lucide-react";

interface TwilioStatus {
  connected: boolean;
  accountSid: string | null;
  fromNumber: string;
  status?: string;
  friendlyName?: string;
  error?: string;
}

interface MessageTemplate {
  id: string;
  type: string;
  title: string;
  template: string;
  enabled: boolean;
  updatedAt: string;
}

interface CustomMessageRecord {
  id: string;
  message: string;
  sentTo: string;
  sentBy: string;
  sentAt: string;
}

interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

// Highlight {variables} in template text
function HighlightedTemplate({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("{") && part.endsWith("}") ? (
          <span
            key={i}
            className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1 rounded font-mono text-xs"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export const dynamic = "force-dynamic";

export default function AutomatedMessagesPage() {
  // Twilio status
  const [twilioStatus, setTwilioStatus] = useState<TwilioStatus | null>(null);
  const [twilioLoading, setTwilioLoading] = useState(true);
  const [testSending, setTestSending] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Custom messages
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [messageHistory, setMessageHistory] = useState<CustomMessageRecord[]>([]);

  // Load all data
  useEffect(() => {
    fetchTwilioStatus();
    fetchTemplates();
    fetchEmployees();
    fetchMessageHistory();
  }, []);

  async function fetchTwilioStatus() {
    setTwilioLoading(true);
    try {
      const res = await fetch("/api/twilio-status");
      if (res.ok) setTwilioStatus(await res.json());
    } catch {
      setTwilioStatus({ connected: false, accountSid: null, fromNumber: "", error: "Failed to check" });
    } finally {
      setTwilioLoading(false);
    }
  }

  async function fetchTemplates() {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/message-templates");
      if (res.ok) setTemplates(await res.json());
    } catch {
      toast.error("Failed to load templates");
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function fetchEmployees() {
    try {
      const res = await fetch("/api/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.filter((e: Employee) => e.phone));
      }
    } catch {}
  }

  async function fetchMessageHistory() {
    try {
      const res = await fetch("/api/send-custom-message");
      if (res.ok) setMessageHistory(await res.json());
    } catch {}
  }

  async function handleTestMessage() {
    setTestSending(true);
    try {
      const res = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: twilioStatus?.fromNumber?.replace("whatsapp:", "") || "",
          message: "META7 AI: Test message from Automated Messages settings. Connection verified!",
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Test message sent successfully!");
      } else {
        toast.error("Failed to send test message");
      }
    } catch {
      toast.error("Failed to send test message");
    } finally {
      setTestSending(false);
    }
  }

  async function handleToggleTemplate(id: string, enabled: boolean) {
    try {
      const res = await fetch("/api/message-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      if (res.ok) {
        setTemplates((prev) =>
          prev.map((t) => (t.id === id ? { ...t, enabled } : t))
        );
        toast.success(enabled ? "Template enabled" : "Template disabled");
      }
    } catch {
      toast.error("Failed to update template");
    }
  }

  async function handleSaveTemplate(id: string) {
    try {
      const res = await fetch("/api/message-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, template: editText }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTemplates((prev) =>
          prev.map((t) => (t.id === id ? updated : t))
        );
        setEditingId(null);
        setEditText("");
        toast.success("Template updated");
      }
    } catch {
      toast.error("Failed to save template");
    }
  }

  async function handleSendCustom() {
    if (!customMessage.trim()) return toast.error("Please enter a message");
    if (!selectAll && selectedEmployees.length === 0)
      return toast.error("Please select at least one employee");

    setSending(true);
    try {
      const res = await fetch("/api/send-custom-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: customMessage,
          employeeIds: selectAll ? ["ALL"] : selectedEmployees,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Message sent to ${data.sentCount}/${data.total} employees`);
        setCustomMessage("");
        setSelectedEmployees([]);
        setSelectAll(false);
        fetchMessageHistory();
      } else {
        toast.error(data.error || "Failed to send");
      }
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automated Messages"
        description="Manage WhatsApp/Twilio message templates and send custom messages"
      />

      {/* ─── Section 1: Twilio Configuration ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="size-5" />
            Twilio Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          {twilioLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking connection...
            </div>
          ) : twilioStatus ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Account SID</Label>
                  <p className="font-mono text-sm mt-1">
                    {twilioStatus.accountSid || "Not configured"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">WhatsApp From</Label>
                  <p className="font-mono text-sm mt-1">{twilioStatus.fromNumber}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    {twilioStatus.connected ? (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 gap-1">
                        <CheckCircle2 className="size-3" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="size-3" />
                        Disconnected
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {twilioStatus.friendlyName && (
                <p className="text-sm text-muted-foreground">
                  Account: {twilioStatus.friendlyName}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestMessage}
                disabled={testSending || !twilioStatus.connected}
              >
                {testSending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <Send className="size-4 mr-2" />
                )}
                Send Test Message
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Unable to check Twilio status</p>
          )}
        </CardContent>
      </Card>

      {/* ─── Section 2: Message Templates ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="size-5" />
            Message Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {templatesLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading templates...
            </div>
          ) : (
            <div className="grid gap-4">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={t.enabled}
                        onCheckedChange={(checked: boolean) =>
                          handleToggleTemplate(t.id, checked)
                        }
                      />
                      <h4 className="font-medium text-sm">{t.title}</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.enabled ? "default" : "secondary"}>
                        {t.enabled ? "Active" : "Disabled"}
                      </Badge>
                      {editingId === t.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSaveTemplate(t.id)}
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(null);
                              setEditText("");
                            }}
                          >
                            <X className="size-4" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(t.id);
                            setEditText(t.template);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {editingId === t.id ? (
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="font-mono text-xs"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      <HighlightedTemplate text={t.template} />
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Section 3: Custom Messages ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-5" />
            Send Custom Message
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Employee selection */}
          <div className="space-y-2">
            <Label>Recipients</Label>
            <div className="flex items-center gap-2 mb-2">
              <Checkbox
                checked={selectAll}
                onCheckedChange={(checked: boolean) => {
                  setSelectAll(checked);
                  if (checked) setSelectedEmployees([]);
                }}
              />
              <span className="text-sm font-medium">All Employees</span>
            </div>
            {!selectAll && (
              <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                {employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No employees with phone numbers found
                  </p>
                ) : (
                  employees.map((emp) => (
                    <label
                      key={emp.id}
                      className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/50 rounded px-2"
                    >
                      <Checkbox
                        checked={selectedEmployees.includes(emp.id)}
                        onCheckedChange={(checked: boolean) =>
                          setSelectedEmployees((prev) =>
                            checked
                              ? [...prev, emp.id]
                              : prev.filter((id) => id !== emp.id)
                          )
                        }
                      />
                      <span className="text-sm">
                        {emp.firstName} {emp.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({emp.employeeId})
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Message input */}
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Type your message here..."
              rows={4}
            />
          </div>

          <Button
            onClick={handleSendCustom}
            disabled={sending}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Send className="size-4 mr-2" />
            )}
            Send Message
          </Button>

          {/* Message History */}
          {messageHistory.length > 0 && (
            <div className="mt-6 space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Clock className="size-4" />
                Recent Messages (Last 10)
              </h4>
              <div className="space-y-2">
                {messageHistory.map((msg) => (
                  <div
                    key={msg.id}
                    className="border rounded-lg p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary">
                        {msg.sentTo === "ALL" ? "All Employees" : `${msg.sentTo.split(",").length} employee(s)`}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(msg.sentAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{msg.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
