import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PayrollView } from "@/components/payroll/payroll-view";
import { generatePayrollForEmployee, generatePayrollForAll } from "@/lib/services/payroll.service";
import { autoHealBogusCheckouts } from "@/lib/services/auto-heal-bogus-checkouts";
import { isMaintenanceMode } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // SELF-HEAL: revert bogus auto-checkout records before regenerating payroll
  // so the regen reads correct attendance, not the legacy 14:00 UTC stamps.
  await autoHealBogusCheckouts().catch((e) => console.warn("[auto-heal]", e));

  const params = await searchParams;
  const role = (session.user as any).role;
  const isAdmin = role === "SUPER_ADMIN";
  const isPartner = role === "PARTNER";
  // CEO + Partner both get the manager view (table of all team payroll +
  // Mark Paid actions). Employees see their own salary only.
  const isManagerView = isAdmin || isPartner;
  const _pkt = new Date(Date.now() + 5 * 60 * 60_000);
  const month = params.month ? parseInt(params.month) : _pkt.getUTCMonth() + 1;
  const year = params.year ? parseInt(params.year) : _pkt.getUTCFullYear();
  const currentMonth = _pkt.getUTCMonth() + 1;
  const currentYear = _pkt.getUTCFullYear();

  // Resolve PARTNER scope: which user ids do they manage?
  let partnerMemberIds: string[] | null = null;
  let partnerOfficeId: string | null = null;
  if (isPartner) {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        officeId: true,
        partnerTeams: {
          select: {
            members: {
              where: { status: { in: ["HIRED", "PROBATION"] } },
              select: { id: true },
            },
          },
        },
      },
    });
    partnerOfficeId = me?.officeId ?? null;
    partnerMemberIds = me?.partnerTeams.flatMap((t) => t.members.map((m) => m.id)) ?? [];
  }

  // Look up the office snapshot for this view (CEO sees primary office;
  // PARTNER sees their own office). Snapshots are per-office in Phase 3.
  const snapshotOfficeFilter = isPartner
    ? { id: partnerOfficeId ?? "__none__" }
    : { isPrimary: true };
  const monthSnapshot = await prisma.payrollSnapshot.findFirst({
    where: { month, year, office: snapshotOfficeFilter },
    include: { lockedBy: { select: { firstName: true, lastName: true } } },
  });
  const monthLocked = !!monthSnapshot;

  const isCurrentMonth = month === currentMonth && year === currentYear;
  // `&& !isMaintenanceMode()` — merely OPENING this page regenerates payroll
  // for the whole roster (upserts records, creates and re-prices absent
  // fines). That must not happen silently while the portal is locked and the
  // data behind it is mid-upgrade. The CEO can still regenerate deliberately
  // from the Generate button; this only stops the write that fires just
  // because a page was viewed.
  if (isCurrentMonth && !monthLocked && !isMaintenanceMode()) {
    try {
      if (isAdmin) {
        await generatePayrollForAll(month, year, session.user.id);
      } else if (isPartner && partnerMemberIds && partnerMemberIds.length > 0) {
        // Regenerate every member's record (skips PAID/locked internally)
        await Promise.all(
          partnerMemberIds.map((id) =>
            generatePayrollForEmployee(id, month, year, session.user.id).catch(() => {})
          )
        );
      } else {
        // Regular employee view — own record only
        const existing = await prisma.payrollRecord.findUnique({
          where: { userId_month_year: { userId: session.user.id, month, year } },
          select: { status: true, lockedAt: true },
        });
        if (!existing || (existing.status !== "PAID" && !existing.lockedAt)) {
          await generatePayrollForEmployee(session.user.id, month, year, session.user.id).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("[payroll] auto-regen failed, serving stale data:", e);
    }
  }

  // Only show employees who joined ON or BEFORE the last day of the payroll month
  const payrollMonthEnd = new Date(Date.UTC(year, month, 0));

  const where: any = {
    month,
    year,
    user: {
      joiningDate: { lte: payrollMonthEnd },
      status: { not: "RESIGNED" },
    },
  };
  if (isPartner) {
    // Scope to partner's team members only
    where.userId = partnerMemberIds && partnerMemberIds.length > 0 ? { in: partnerMemberIds } : "__none__";
  } else if (!isAdmin) {
    where.userId = session.user.id;
  } else {
    where.user.role = { not: "SUPER_ADMIN" };
  }

  const records = await prisma.payrollRecord.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          employeeId: true,
          status: true,
          designation: true,
          bankName: true,
          accountNumber: true,
          accountTitle: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { user: { firstName: "asc" } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description={
          isAdmin
            ? "Generate and manage monthly payroll"
            : isPartner
            ? "Manage your team's monthly payroll"
            : "Your salary details"
        }
      />
      <PayrollView
        records={JSON.parse(JSON.stringify(records))}
        isAdmin={isManagerView}
        isCeo={isAdmin}
        currentMonth={month}
        currentYear={year}
        monthLocked={monthLocked}
        lockInfo={monthSnapshot ? JSON.parse(JSON.stringify({
          lockedAt: monthSnapshot.lockedAt,
          lockedBy: monthSnapshot.lockedBy
            ? `${monthSnapshot.lockedBy.firstName} ${monthSnapshot.lockedBy.lastName || ""}`.trim()
            : "",
          totalNet: monthSnapshot.totalNet,
          recordCount: monthSnapshot.recordCount,
        })) : null}
      />
    </div>
  );
}
