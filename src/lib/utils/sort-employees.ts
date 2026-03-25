/**
 * Sort employees by ID: EM-1, EM-2, EM-3, EM-4B, EM-5, EM-6, EM-7, EM-8, EM-9, EM-10
 * Manager (EM-4) always goes last.
 */
export function sortByEmployeeId<T extends { employeeId?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const parseId = (id: string | null | undefined) => {
      if (!id) return { num: 998, suffix: "", isManager: false };
      // EM-4 (Manager) goes to the end
      if (id === "EM-4") return { num: 999, suffix: "", isManager: true };
      const match = id.match(/EM-(\d+)(.*)/i);
      if (!match) return { num: 998, suffix: "", isManager: false };
      return { num: parseInt(match[1]), suffix: match[2] || "", isManager: false };
    };
    const pa = parseId(a.employeeId);
    const pb = parseId(b.employeeId);
    if (pa.num !== pb.num) return pa.num - pb.num;
    return pa.suffix.localeCompare(pb.suffix);
  });
}

/**
 * Sort nested employee data (e.g., records with user.employeeId)
 */
export function sortByNestedEmployeeId<T extends { user?: { employeeId?: string | null } }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const parseId = (id: string | null | undefined) => {
      if (!id) return { num: 998, suffix: "" };
      if (id === "EM-4") return { num: 999, suffix: "" };
      const match = id.match(/EM-(\d+)(.*)/i);
      if (!match) return { num: 998, suffix: "" };
      return { num: parseInt(match[1]), suffix: match[2] || "" };
    };
    const pa = parseId(a.user?.employeeId);
    const pb = parseId(b.user?.employeeId);
    if (pa.num !== pb.num) return pa.num - pb.num;
    return pa.suffix.localeCompare(pb.suffix);
  });
}
