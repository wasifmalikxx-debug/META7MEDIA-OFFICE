/**
 * Sort employees by ID: EM-1, EM-2, ..., EM-10, EM-4 (Manager last)
 * Also handles SMM-1, SMM-2, ..., SMM-10
 * Groups by prefix (EM first, then SMM), sorted numerically within each group.
 */

function parseEmployeeId(id: string | null | undefined) {
  if (!id) return { prefix: "ZZZ", num: 998, suffix: "" };
  // EM-4 (Manager) goes to the very end of EM group
  if (id === "EM-4") return { prefix: "EM", num: 999, suffix: "" };
  // Match patterns like EM-1, EM-4B, SMM-1, SMM-10
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
