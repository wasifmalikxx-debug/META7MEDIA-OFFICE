import { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
    employeeId: string;
    // Device-binding status decided at login. "BYPASS" for SUPER_ADMIN,
    // "APPROVED"/"PENDING"/"REJECTED" for a known device, "UNKNOWN" when no
    // fingerprint was supplied. Only ENFORCED when DEVICE_ENFORCEMENT=true.
    deviceStatus?: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      employeeId: string;
      deviceStatus?: string;
    };
  }

  interface JWT {
    role: Role;
    employeeId: string;
    deviceStatus?: string;
  }
}
