"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  Clock,
  Eye,
  EyeOff,
  ShieldCheck,
  Star,
  Store,
  Target,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  BoxReveal,
  BrandOrbit,
  GlowInput,
  type OrbitItem,
} from "@/components/blocks/modern-animated-sign-in";

/**
 * Sign in — 21st.dev "Modern Animated Sign In", rebuilt on our theme.
 *
 * Presentation only: the fingerprint load, the next-auth call, the role
 * branch and the device-approval handshake below are unchanged from the
 * previous page. Two things the CEO asked to drop are simply not built —
 * there is no "Login with Google" (the app has no OAuth provider) and no
 * "Forgot password" (there is no reset route; the CEO resets passwords).
 *
 * The orbiting icons are the portal's own modules rather than the reference's
 * devicon logos, and they are lucide components, so the page makes no network
 * request for artwork. That matters here more than anywhere else in the app:
 * this is the screen people hit on bad hotel wifi.
 */

/** What the portal does, orbiting the brand. Radii/durations follow the
 *  reference's three-ring rhythm: 2 close, 3 mid, 2 wide, 2 outer. */
const ORBIT: OrbitItem[] = [
  { node: <CalendarClock className="size-4" />, radius: 108, duration: 22, delay: 0 },
  { node: <Wallet className="size-4" />, radius: 108, duration: 22, delay: 11 },
  { node: <Users className="size-5" />, radius: 168, duration: 26, delay: 0, reverse: true },
  { node: <BarChart3 className="size-5" />, radius: 168, duration: 26, delay: 9, reverse: true },
  { node: <CalendarDays className="size-5" />, radius: 168, duration: 26, delay: 18, reverse: true },
  { node: <Target className="size-5" />, radius: 232, duration: 30, delay: 0 },
  { node: <Star className="size-5" />, radius: 232, duration: 30, delay: 15 },
  { node: <Store className="size-5" />, radius: 296, duration: 36, delay: 0, reverse: true },
  { node: <ShieldCheck className="size-5" />, radius: 296, duration: 36, delay: 18, reverse: true },
];

const ORBIT_ITEMS: OrbitItem[] = ORBIT.map((item) => ({
  ...item,
  className:
    "size-9 rounded-full border border-border bg-card text-muted-foreground shadow-sm " +
    "flex items-center justify-center",
}));

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<
    "checking" | "approved" | "pending" | "rejected" | null
  >(null);
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
        const hash = Array.from(raw)
          .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
          .toString(36);
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
        // Sent so the server can decide this device's status at login. Harmless
        // when DEVICE_ENFORCEMENT is off; required for it to work when on.
        fingerprint: fingerprint ?? "",
        deviceName: getDeviceName(),
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

  const logo = (
    <img
      src="/logo-mark-128.png"
      srcSet="/logo-mark-28.png 28w, /logo-mark-56.png 56w, /logo-mark-84.png 84w, /logo-mark-128.png 128w"
      sizes="56px"
      alt="META7MEDIA"
      className="size-14 object-contain"
    />
  );

  return (
    <div className="flex min-h-svh bg-background">
      {/* ── Brand panel ──
          Hidden below lg: the orbit needs ~600px of square to read, and the
          form is the only thing that matters on a phone. */}
      {/* .app-canvas, not bg-canvas — there is no --color-canvas token, so
          `bg-canvas` compiles to nothing at all. */}
      <section className="app-canvas relative hidden w-1/2 items-center justify-center overflow-hidden border-r border-border lg:flex">
        <BrandOrbit items={ORBIT_ITEMS}>
          <span className="mb-4 flex size-20 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            {logo}
          </span>
          <span className="bg-gradient-to-b from-foreground to-foreground/35 bg-clip-text text-5xl font-semibold leading-none tracking-tight text-transparent xl:text-6xl">
            META7MEDIA
          </span>
          <span className="mt-3 text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Office Manager
          </span>
        </BrandOrbit>
      </section>

      {/* ── Form ── */}
      <section className="flex w-full flex-col justify-center px-6 py-12 sm:px-10 lg:w-1/2">
        <div className="mx-auto w-full max-w-[380px]">
          {/* Brand lockup for phones, where the orbit panel is gone. */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <span className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
              {logo}
            </span>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">META7MEDIA</h1>
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Office Manager
            </p>
          </div>

          {/* Device pending */}
          {deviceStatus === "pending" && (
            <div className="space-y-4 rounded-2xl border border-border bg-card p-8 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <Clock className="size-7 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Awaiting Approval</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  This is your first sign-in from this device. Your request has been sent to
                  the CEO for approval.
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Please wait for approval or contact your administrator.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeviceStatus(null);
                  setError("");
                }}
              >
                Try Again
              </Button>
            </div>
          )}

          {/* Device rejected */}
          {deviceStatus === "rejected" && (
            <div className="space-y-4 rounded-2xl border border-border bg-card p-8 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <XCircle className="size-7 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Access Denied</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  This device has been rejected. You can only access the system from approved
                  devices.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeviceStatus(null);
                  setError("");
                }}
              >
                Back to Sign In
              </Button>
            </div>
          )}

          {/* Sign-in form */}
          {!deviceStatus && (
            <>
              <BoxReveal duration={0.35}>
                <h2 className="text-3xl font-semibold tracking-tight">Welcome back</h2>
              </BoxReveal>
              <BoxReveal duration={0.35} delay={0.08} className="mt-2 mb-7">
                <p className="text-sm text-muted-foreground">
                  Sign in to the META7MEDIA office portal.
                </p>
              </BoxReveal>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/30">
                    <XCircle className="size-4 shrink-0 text-rose-500" />
                    <span className="text-sm text-rose-700 dark:text-rose-400">{error}</span>
                  </div>
                )}

                <BoxReveal width="100%" duration={0.35} delay={0.16}>
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-[13px] text-muted-foreground">
                      Email address
                    </Label>
                    <GlowInput
                      id="email"
                      type="email"
                      placeholder="employee@meta7.media"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </BoxReveal>

                <BoxReveal width="100%" duration={0.35} delay={0.24}>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-[13px] text-muted-foreground">
                      Password
                    </Label>
                    <div className="relative">
                      <GlowInput
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground/70 transition-colors hover:text-foreground"
                      >
                        {showPassword ? (
                          <Eye className="size-4" />
                        ) : (
                          <EyeOff className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </BoxReveal>

                <BoxReveal width="100%" duration={0.35} delay={0.32}>
                  <Button
                    type="submit"
                    className="h-11 w-full gap-2 rounded-lg text-sm font-semibold"
                    disabled={loading}
                  >
                    {loading ? (
                      deviceStatus === "checking" ? (
                        "Verifying device…"
                      ) : (
                        "Signing in…"
                      )
                    ) : (
                      <>
                        Sign in
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </Button>
                </BoxReveal>

                {fingerprint && (
                  <div className="flex items-center justify-center gap-1.5 pt-1">
                    <ShieldCheck className="size-3 text-emerald-500" />
                    <span className="text-[10px] text-muted-foreground/60">
                      Secured with device fingerprint
                    </span>
                  </div>
                )}
              </form>
            </>
          )}

          <div className="mt-10 space-y-1 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/50">
              <Building2 className="size-3" />
              <span>META7MEDIA Private Limited</span>
            </div>
            <p className="text-[9px] text-muted-foreground/40">Powered by META7MEDIA AI</p>
          </div>
        </div>
      </section>
    </div>
  );
}
