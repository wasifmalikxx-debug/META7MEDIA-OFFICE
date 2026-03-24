import { prisma } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return { hours, minutes };
}

function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export async function getOfficeSettings() {
  let settings = await prisma.officeSettings.findUnique({
    where: { id: "default" },
  });
  if (!settings) {
    settings = await prisma.officeSettings.create({
      data: { id: "default" },
    });
  }
  return settings;
}

export async function validateIp(ip: string): Promise<boolean> {
  const settings = await getOfficeSettings();
  if (!settings.ipRestrictionEnabled) return true;
  if (!settings.allowedIps) return true;

  const allowedList = settings.allowedIps
    .split(",")
    .map((s) => s.trim())
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
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Check if already checked in today
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (existing?.checkIn) {
    throw new Error("Already checked in today");
  }

  // Calculate late status
  const startTime = parseTime(settings.workStartTime);
  const startMinutes = startTime.hours * 60 + startTime.minutes;
  const currentMinutes = getMinutesSinceMidnight(now);
  const lateMinutes = Math.max(0, currentMinutes - startMinutes - settings.graceMinutes);

  let status: AttendanceStatus = AttendanceStatus.PRESENT;
  if (lateMinutes > 0) {
    status = AttendanceStatus.LATE;
  }
  if (currentMinutes - startMinutes >= settings.autoAbsentAfterMin) {
    status = AttendanceStatus.ABSENT;
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
  if (lateMinutes > 0) {
    let fineAmount = 0;
    if (lateMinutes >= settings.lateFineTier3Min && settings.lateFineTier3Amt > 0) {
      fineAmount = settings.lateFineTier3Amt;
    } else if (lateMinutes >= settings.lateFineTier2Min && settings.lateFineTier2Amt > 0) {
      fineAmount = settings.lateFineTier2Amt;
    } else if (lateMinutes >= settings.lateFineTier1Min && settings.lateFineTier1Amt > 0) {
      fineAmount = settings.lateFineTier1Amt;
    }

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
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            issuedById: adminUser.id,
            linkedAttendanceId: attendance.id,
          },
        });
      }
    }
  }

  return attendance;
}

export async function checkOut(userId: string, ip: string, lat?: number, lng?: number) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

  const workedMinutes = Math.floor(
    (now.getTime() - attendance.checkIn.getTime()) / (1000 * 60)
  );

  // Check if half day
  let status = attendance.status;
  if (workedMinutes < settings.halfDayThresholdMin) {
    status = AttendanceStatus.HALF_DAY;
  }

  // Calculate overtime
  const endTime = parseTime(settings.workEndTime);
  const startTime = parseTime(settings.workStartTime);
  const standardMinutes = (endTime.hours * 60 + endTime.minutes) - (startTime.hours * 60 + startTime.minutes);
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
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

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
