import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Device-binding fields, sent by the login page. Used to decide the
        // device status at login (see deviceStatus below). Optional — the
        // device control only takes effect when DEVICE_ENFORCEMENT=true.
        fingerprint: { label: "Fingerprint", type: "text" },
        deviceName: { label: "Device", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || user.status === "RESIGNED" || user.status === "TERMINATED") return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );
        if (!isValid) return null;

        // ── Device-binding decision (carried in the session as a claim) ──
        // This is computed at every login. It is ENFORCED only when
        // DEVICE_ENFORCEMENT=true (see api-helpers.isDeviceSessionBlocked +
        // the dashboard layout). When the flag is off, this value is purely
        // informational and changes nothing about who can log in.
        //
        // Wrapped in try/catch so a device-table hiccup can NEVER block a
        // legitimate login while the feature is dormant.
        let deviceStatus = "BYPASS"; // SUPER_ADMIN (CEO) is never device-gated
        if (user.role !== "SUPER_ADMIN") {
          try {
            const fingerprint =
              typeof credentials.fingerprint === "string" ? credentials.fingerprint : "";
            if (!fingerprint) {
              deviceStatus = "UNKNOWN";
            } else {
              const existing = await prisma.deviceApproval.findUnique({
                where: { userId_fingerprint: { userId: user.id, fingerprint } },
              });
              // Read-only here. A brand-new device resolves to PENDING; the
              // login page's POST /api/device-approval then creates the row
              // (with IP) right after sign-in so the CEO can approve it.
              deviceStatus = existing ? existing.status : "PENDING";
            }
          } catch (err) {
            // Fail closed for enforcement (UNKNOWN is treated as not-approved),
            // but never throw — login itself must not break.
            console.warn("[auth] device status lookup failed:", (err as Error).message);
            deviceStatus = "UNKNOWN";
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          employeeId: user.employeeId,
          status: user.status,
          deviceStatus,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.employeeId = (user as any).employeeId;
        token.deviceStatus = (user as any).deviceStatus;
        (token as any).status = (user as any).status;
        (token as any).checkedAt = Date.now();
      } else if (token.sub) {
        // H1: periodically re-validate the live account so a TERMINATED/
        // RESIGNED user (or a role change/demotion) takes effect without
        // waiting ~30 days for the JWT to expire. Bounded to once per interval
        // to respect the connection_limit=2 pool. Never throws — a transient DB
        // error leaves the token untouched rather than logging the user out.
        const REVALIDATE_MS = 5 * 60_000;
        const last = typeof (token as any).checkedAt === "number" ? (token as any).checkedAt : 0;
        if (Date.now() - last > REVALIDATE_MS) {
          try {
            const fresh = await prisma.user.findUnique({
              where: { id: token.sub },
              select: { role: true, status: true },
            });
            if (!fresh) {
              (token as any).status = "GONE";
            } else {
              token.role = fresh.role;
              (token as any).status = fresh.status;
            }
            (token as any).checkedAt = Date.now();
          } catch {
            // leave token as-is on transient error
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as any).role = token.role;
        (session.user as any).employeeId = token.employeeId;
        (session.user as any).deviceStatus = (token as any).deviceStatus;
        (session.user as any).status = (token as any).status;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
