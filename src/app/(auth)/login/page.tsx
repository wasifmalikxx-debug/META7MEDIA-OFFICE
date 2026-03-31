"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Clock, XCircle, Lock, Mail, ArrowRight, Building2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<"checking" | "approved" | "pending" | "rejected" | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function loadFingerprint() {
      try {
        const FingerprintJS = (await import("@fingerprintjs/fingerprintjs")).default;
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        setFingerprint(result.visitorId);
      } catch {
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

      const sessionRes = await fetch("/api/auth/session");
      const session = await sessionRes.json();
      const role = session?.user?.role;

      if (role === "SUPER_ADMIN") {
        router.push("/dashboard");
        router.refresh();
        return;
      }

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
        await fetch("/api/auth/signout", { method: "POST" });
      } else {
        setDeviceStatus("pending");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 size-80 rounded-full bg-blue-500/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 size-80 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        {/* Logo & Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-white dark:bg-slate-800 shadow-lg shadow-slate-200/50 dark:shadow-slate-950/50 mb-5 border border-slate-100 dark:border-slate-700">
            <img src="/logo.png" alt="META7MEDIA" className="size-10 object-contain" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">META7MEDIA</h1>
          <p className="text-sm text-muted-foreground mt-1">AI-Powered Office Management System</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl shadow-slate-200/40 dark:shadow-slate-950/40 border border-slate-200/60 dark:border-slate-800 overflow-hidden">

          {/* Device Pending */}
          {deviceStatus === "pending" && (
            <div className="p-8 text-center space-y-4">
              <div className="size-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
                <Clock className="size-7 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Awaiting Approval</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  This is your first sign-in from this device. Your request has been sent to the CEO for approval.
                </p>
              </div>
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Please wait for approval or contact your administrator.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setDeviceStatus(null); setError(""); }} className="rounded-full px-6">
                Try Again
              </Button>
            </div>
          )}

          {/* Device Rejected */}
          {deviceStatus === "rejected" && (
            <div className="p-8 text-center space-y-4">
              <div className="size-14 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto">
                <XCircle className="size-7 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Access Denied</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  This device has been rejected. You can only access the system from approved devices.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setDeviceStatus(null); setError(""); }} className="rounded-full px-6">
                Back to Sign In
              </Button>
            </div>
          )}

          {/* Login Form */}
          {!deviceStatus && (
            <>
              <div className="px-8 pt-7 pb-2">
                <h2 className="text-lg font-bold">Sign in to your account</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Enter your credentials to access the portal</p>
              </div>

              <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-5">
                {error && (
                  <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-3 flex items-center gap-2.5">
                    <XCircle className="size-4 text-rose-500 shrink-0" />
                    <span className="text-sm text-rose-700 dark:text-rose-400">{error}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="employee@meta7.media"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      className="pl-10 h-11 rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-semibold">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="pl-10 h-11 rounded-lg"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-11 rounded-lg gap-2 text-sm font-semibold" disabled={loading}>
                  {loading ? (
                    deviceStatus === "checking" ? "Verifying device..." : "Signing in..."
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>

                {fingerprint && (
                  <div className="flex items-center justify-center gap-1.5 pt-1">
                    <ShieldCheck className="size-3 text-emerald-500" />
                    <span className="text-[10px] text-muted-foreground/50">Secured with device fingerprint</span>
                  </div>
                )}
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6 space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40">
            <Building2 className="size-3" />
            <span>META7MEDIA Private Limited</span>
          </div>
          <p className="text-[9px] text-muted-foreground/30">
            Powered by META7MEDIA AI
          </p>
        </div>
      </div>
    </div>
  );
}
