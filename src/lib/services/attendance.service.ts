import { prisma, getCachedSettings } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";
import { sendLateFineTemplate } from "@/lib/services/whatsapp.service";
import { todayPKT, nowPKT, pktMinutesSinceMidnight, pktMonth, pktYear } from "@/lib/pkt";
import { resolveAttendanceStatus } from "@/lib/services/attendance-status";
import { maybeCreateBreakSkipFine } from "@/lib/services/break-fine";

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return { hours, minutes };
}

export async function getOfficeSettings() {
  return getCachedSettings();
}

export async function validateIp(ip: string): Promise<boolean> {
  const settings = await getOfficeSettings();
  if (!settings.ipRestrictionEnabled) return true;
  if (!settings.allowedIps) return true;

  const allowedList = settings.allowedIps
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  if (allowedList.length === 0) return true;

  return allowedList.includes(ip);
}

export async function checkIn(
  userId: string,
  ip: string,
  lat?: number,
  lng?: number
) {
  const settings = await getOfficeSettings();
  const now = nowPKT();
  const today = todayPKT();

  // Join-date guard: an employee cannot check in before their joining date.
  // Prevents an accidentally-future-joining employee (e.g. admin sets joining
  // date = tomorrow) from starting to check in today.
  const employee = await prisma.user.findUnique({
    where: { id: userId },
    select: { joiningDate: true },
  });
  if (employee && employee.joiningDate && employee.joiningDate.getTime() > today.getTime()) {
    const dateStr = employee.joiningDate.toISOString().slice(0, 10);
    throw new Error(`Check-in not allowed yet — your joining date is ${dateStr}.`);
  }

  // Check if already checked in today or marked absent by system
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (existing?.checkIn) {
    throw new Error("Already checked in today");
  }
  if (existing?.status === "ABSENT") {
    throw new Error("You have been marked absent for today. Contact your CEO if this is incorrect.");
  }

  // Check if employee has a FIRST_HALF leave today — they'll arrive after break, no late fine
  const firstHalfLeave = await prisma.leaveRequest.findFirst({
    where: {
      userId,
      leaveType: "HALF_DAY",
      halfDayPeriod: "FIRST_HALF",
      startDate: today,
      status: "APPROVED",
    },
  });

  // Calculate late status using Pakistan time (UTC+5)
  // Grace period: no fine if arrive within grace minutes after start
  // After grace: late minutes counted from office start (not from grace end)
  const startTime = parseTime(settings.workStartTime);
  const startMinutes = startTime.hours * 60 + startTime.minutes;
  const currentMinutes = pktMinutesSinceMidnight();
  const minutesPastStart = Math.max(0, currentMinutes - startMinutes);
  let lateMinutes = minutesPastStart > settings.graceMinutes ? minutesPastStart : 0;

  // If employee has first-half leave, they are NOT late — they're expected after break
  if (firstHalfLeave) {
    lateMinutes = 0;
  }

  // If employee physically checks in, they are PRESENT or LATE — never ABSENT
  // ABSENT is only for employees who don't show up at all (end-of-day system marking)
  let status: AttendanceStatus = AttendanceStatus.PRESENT;
  if (lateMinutes > 0) {
    status = AttendanceStatus.LATE;
  }

  const attendance = await prisma.attendance.upsert({
    where: { userId_date: { userId, date: today } },
    create: {
      userId,
      date: today,
      checkIn: now,
      status,
      checkInIp: ip,
      checkInLat: lat,
      checkInLng: lng,
      lateMinutes: lateMinutes > 0 ? lateMinutes : null,
    },
    update: {
      checkIn: now,
      status,
      checkInIp: ip,
      checkInLat: lat,
      checkInLng: lng,
      lateMinutes: lateMinutes > 0 ? lateMinutes : null,
    },
  });

  // Auto-create late fine if applicable
  console.log(`[CHECK-IN] ${userId} | PKT min: ${currentMinutes} | Start: ${startMinutes} | Grace: ${settings.graceMinutes} | Late: ${lateMinutes}min | Tiers: ${settings.lateFineTier1Amt}/${settings.lateFineTier2Amt}/${settings.lateFineTier3Amt}`);
  if (lateMinutes > 0) {
    let fineAmount = 0;
    if (lateMinutes >= settings.lateFineTier3Min && settings.lateFineTier3Amt > 0) {
      fineAmount = settings.lateFineTier3Amt;
    } else if (lateMinutes >= settings.lateFineTier2Min && settings.lateFineTier2Amt > 0) {
      fineAmount = settings.lateFineTier2Amt;
    } else if (lateMinutes >= settings.lateFineTier1Min && settings.lateFineTier1Amt > 0) {
      fineAmount = settings.lateFineTier1Amt;
    }
    console.log(`[CHECK-IN] Late fine: ${fineAmount} PKR for ${lateMinutes}min late`);

    if (fineAmount > 0) {
      // Find a system/admin user for the issuedById field
      const adminUser = await prisma.user.findFirst({
        where: { role: "SUPER_ADMIN" },
      });
      if (adminUser) {
        await prisma.fine.create({
          data: {
            userId,
            type: "LATE_ARRIVAL",
            amount: fineAmount,
            reason: `Auto-generated: ${lateMinutes} minutes late`,
            date: today,
            month: pktMonth(),
            year: pktYear(),
            issuedById: adminUser.id,
            linkedAttendanceId: attendance.id,
          },
        });

        // WhatsApp: notify employee about late fine via template (fire-and-forget)
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, phone: true } });
        const empName = user ? `${user.firstName} ${user.lastName || ""}`.trim() : "Employee";
        if (user?.phone) {
          sendLateFineTemplate(user.phone, empName, lateMinutes, fineAmount).catch((e) => console.error(`[WHATSAPP] Late fine to ${user.phone} failed:`, e.message));
        }
      }
    }
  }

  return attendance;
}

export async function checkOut(userId: string, ip: string, lat?: number, lng?: number) {
  const now = nowPKT();
  const today = todayPKT();
  const settings = await getOfficeSettings();

  const attendance = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  });

  if (!attendance || !attendance.checkIn) {
    throw new Error("No check-in found for today");
  }
  if (attendance.checkOut) {
    throw new Error("Already checked out today");
  }

  // Subtract break time from worked minutes (only if break was completed)
  let breakMinutes = 0;
  if (attendance.breakStart && attendance.breakEnd) {
    breakMinutes = Math.floor(
      (attendance.breakEnd.getTime() - attendance.breakStart.getTime()) / (1000 * 60)
    );
  }
  const workedMinutes = Math.floor(
    (now.getTime() - attendance.checkIn.getTime()) / (1000 * 60)
  ) - breakMinutes;

  // Block checkout if threshold not met
  if (workedMinutes < settings.halfDayThresholdMin) {
    const hoursNeeded = Math.floor(settings.halfDayThresholdMin / 60);
    const minsNeeded = settings.halfDayThresholdMin % 60;
    const hoursWorked = Math.floor(workedMinutes / 60);
    const minsWorked = workedMinutes % 60;
    throw new Error(
      `You must complete at least ${hoursNeeded}h ${minsNeeded}m before checking out for half day. You have worked ${hoursWorked}h ${minsWorked}m so far.`
    );
  }

  // Break skip fine — use single source of truth
  const adminUser = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (adminUser) {
    await maybeCreateBreakSkipFine({
      userId,
      date: today,
      breakStart: attendance.breakStart,
      checkIn: attendance.checkIn,
      checkOut: now,
      workedMinutes,
      adminId: adminUser.id,
    });
  }

  // Resolve status using single source of truth
  const resolved = await resolveAttendanceStatus({
    userId,
    date: today,
    workedMinutes,
    lateMinutes: attendance.lateMinutes,
    currentStatus: attendance.status,
  });
  const status = resolved.status;
  const officeEnd = parseTime(settings.workEndTime);
  const officeStart = parseTime(settings.workStartTime);
  const fullDayMinutes = (officeEnd.hours * 60 + officeEnd.minutes) - (officeStart.hours * 60 + officeStart.minutes);

  // Calculate overtime
  const standardMinutes = fullDayMinutes;
  const overtimeMinutes = Math.max(0, workedMinutes - standardMinutes);

  // Early leave
  const earlyLeaveMin = Math.max(0, standardMinutes - workedMinutes);

  return prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      checkOut: now,
      checkOutIp: ip,
      checkOutLat: lat,
      checkOutLng: lng,
      workedMinutes,
      overtimeMinutes: overtimeMinutes > 0 ? overtimeMinutes : null,
      earlyLeaveMin: earlyLeaveMin > 0 ? earlyLeaveMin : null,
      status,
    },
  });
}

export async function getAttendanceSummary(
  userId: string,
  month: number,
  year: number
) {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0));

  const attendances = await prisma.attendance.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: "asc" },
  });

  const summary = {
    present: 0,
    late: 0,
    halfDay: 0,
    absent: 0,
    onLeave: 0,
    totalWorkedMinutes: 0,
    totalLateMintues: 0,
    records: attendances,
  };

  for (const att of attendances) {
    switch (att.status) {
      case "PRESENT":
        summary.present++;
        break;
      case "LATE":
        summary.late++;
        summary.present++;
        break;
      case "HALF_DAY":
        summary.halfDay++;
        break;
      case "ABSENT":
        summary.absent++;
        break;
      case "ON_LEAVE":
        summary.onLeave++;
        break;
    }
    summary.totalWorkedMinutes += att.workedMinutes || 0;
    summary.totalLateMintues += att.lateMinutes || 0;
  }

  return summary;
}
