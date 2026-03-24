import { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
    employeeId: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      employeeId: string;
    };
  }

  interface JWT {
    role: Role;
    employeeId: string;
  }
}
