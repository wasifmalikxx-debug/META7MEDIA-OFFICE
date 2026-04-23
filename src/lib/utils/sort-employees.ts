/**
 * Sort employees by ID. Groups by prefix, sorted numerically within each
 * group. Handles patterns like EMP-1, EMP-2, ..., HR-1, HR-2, etc.
 */

function parseEmployeeId(id: string | null | undefined) {
  if (!id) return { prefix: "ZZZ", num: 998, suffix: "" };
  // Match patterns like EMP-1, EMP-4B, HR-1, HR-10
  const match = id.match(/^([A-Z]+)-(\d+)(.*)/i);
  if (!match) return { prefix: "ZZZ", num: 998, suffix: "" };
  return { prefix: match[1].toUpperCase(), num: parseInt(match[2]), suffix: match[3] || "" };
}

export function sortByEmployeeId<T extends { employeeId?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = parseEmployeeId(a.employeeId);
    const pb = parseEmployeeId(b.employeeId);
    // Sort by prefix first (EM before SMM)
    if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
    if (pa.num !== pb.num) return pa.num - pb.num;
    return pa.suffix.localeCompare(pb.suffix);
  });
}

export function sortByNestedEmployeeId<T extends { user?: { employeeId?: string | null } }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = parseEmployeeId(a.user?.employeeId);
    const pb = parseEmployeeId(b.user?.employeeId);
    if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
    if (pa.num !== pb.num) return pa.num - pb.num;
    return pa.suffix.localeCompare(pb.suffix);
  });
}
