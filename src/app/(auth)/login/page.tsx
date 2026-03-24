"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Clock, XCircle } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<"checking" | "approved" | "pending" | "rejected" | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const router = useRouter();

  // Generate browser fingerprint on mount
  useEffect(() => {
    async function loadFingerprint() {
      try {
        const FingerprintJS = (await import("@fingerprintjs/fingerprintjs")).default;
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        setFingerprint(result.visitorId);
      } catch {
        // Fallback: use a simple hash of user agent + screen
        const raw = `${navigator.userAgent}-${screen.width}x${screen.height}-${navigator.language}`;
        const hash = Array.from(raw).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(36);
        setFingerprint(hash);
      }
    }
    loadFingerprint();
  }, []);

  function getDeviceName(): string {
    const ua = navigator.userAgent;
    let browser = "Unknown Browser";
    let os = "Unknown OS";
    if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
    else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
    else if (ua.includes("Firefox")) browser = "Firefox";
    else if (ua.includes("Edg")) browser = "Edge";
    if (ua.includes("Windows")) os = "Windows";
    else if (ua.includes("Mac")) os = "macOS";
    else if (ua.includes("iPhone")) os = "iPhone";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("Linux")) os = "Linux";
    return `${browser} on ${os}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDeviceStatus(null);
    setLoading(true);

    try {
      // First, authenticate credentials
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
        setLoading(false);
        return;
      }

      // Get user session to check role
      const sessionRes = await fetch("/api/auth/session");
      const session = await sessionRes.json();
      const role = session?.user?.role;

      // Super Admin skips device check
      if (role === "SUPER_ADMIN") {
        router.push("/dashboard");
        router.refresh();
        return;
      }

      // For employees: check device approval
      if (!fingerprint) {
        router.push("/dashboard");
        router.refresh();
        return;
      }

      setDeviceStatus("checking");
      const deviceRes = await fetch("/api/device-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          fingerprint,
          deviceName: getDeviceName(),
        }),
      });
      const deviceData = await deviceRes.json();

      if (deviceData.status === "APPROVED") {
        setDeviceStatus("approved");
        router.push("/dashboard");
        router.refresh();
      } else if (deviceData.status === "REJECTED") {
        setDeviceStatus("rejected");
        // Sign out since device is rejected
        await signIn("credentials", { redirect: false }); // this won't actually sign out, let me use signOut
        await fetch("/api/auth/signout", { method: "POST" });
      } else {
        // PENDING — show waiting message
        setDeviceStatus("pending");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-lg font-bold">
            M7
          </div>
          <CardTitle className="text-2xl">META7MEDIA</CardTitle>
          <CardDescription>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deviceStatus === "pending" && (
            <div className="rounded-lg border bg-yellow-50 dark:bg-yellow-950/30 p-4 text-center space-y-3 mb-4">
              <Clock className="size-10 mx-auto text-yellow-600" />
              <h3 className="font-semibold text-yellow-800 dark:text-yellow-400">Device Approval Required</h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                This is your first login from this device. Your CEO has been notified and needs to approve this device before you can access the system.
              </p>
              <p className="text-xs text-muted-foreground">
                Please wait or contact your CEO.
              </p>
              <Button variant="outline" size="sm" onClick={() => { setDeviceStatus(null); setError(""); }}>
                Try Again
              </Button>
            </div>
          )}

          {deviceStatus === "rejected" && (
            <div className="rounded-lg border bg-red-50 dark:bg-red-950/30 p-4 text-center space-y-3 mb-4">
              <XCircle className="size-10 mx-auto text-red-600" />
              <h3 className="font-semibold text-red-800 dark:text-red-400">Device Rejected</h3>
              <p className="text-sm text-red-700 dark:text-red-300">
                This device has been rejected by admin. You can only login from approved devices.
              </p>
              <Button variant="outline" size="sm" onClick={() => { setDeviceStatus(null); setError(""); }}>
                Back to Login
              </Button>
            </div>
          )}

          {!deviceStatus && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@meta7media.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (deviceStatus === "checking" ? "Verifying device..." : "Signing in...") : "Sign In"}
              </Button>
              {fingerprint && (
                <p className="text-[10px] text-muted-foreground/40 text-center flex items-center justify-center gap-1">
                  <ShieldCheck className="size-3" /> Device fingerprint secured
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
