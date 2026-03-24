import { NextRequest } from "next/server";
import { json, error, requireRole } from "@/lib/api-helpers";
import { generatePayrollForAll } from "@/lib/services/payroll.service";
import { generatePayrollSchema } from "@/lib/validations/payroll";

export async function POST(request: NextRequest) {
  const session = await requireRole("SUPER_ADMIN", "HR_ADMIN");
  if (!session) return error("Forbidden", 403);

  try {
    const body = await request.json();
    const parsed = generatePayrollSchema.parse(body);

    const results = await generatePayrollForAll(
      parsed.month,
      parsed.year,
      session.user.id
    );

    return json(results);
  } catch (err: any) {
    return error(err.message);
  }
}
