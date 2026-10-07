import type { PermissionManifestEntry, RegisteredPermission } from "./types.js";

export interface PermissionCheck {
  // In the code but not registered in Central yet, so a deploy would add them.
  notRegistered: string[];
  // Registered in Central and current, but gone from the code, so a deploy would drop them.
  wouldDrop: string[];
  // Active roles carry these but the code does not know them, so the application ignores them.
  unknownToCode: string[];
  // Registered with other needs than the code says.
  requiresDiffer: string[];
}

// Compares what the code declares with what Central has registered and what roles carry.
export function comparePermissions(
  code: PermissionManifestEntry[],
  registered: RegisteredPermission[],
  usage: string[],
): PermissionCheck {
  const inCode = new Set(code.map((entry) => entry.key));
  const current = registered.filter((entry) => !entry.deprecated);
  const same = (left: string[] = [], right: string[] = []) =>
    [...left].sort().join("\n") === [...right].sort().join("\n");
  return {
    notRegistered: code.filter((entry) => !current.some((row) => row.key === entry.key)).map((entry) => entry.key),
    wouldDrop: current.filter((row) => !inCode.has(row.key)).map((row) => row.key),
    unknownToCode: usage.filter((key) => !inCode.has(key)),
    requiresDiffer: code
      .filter((entry) => {
        const row = current.find((candidate) => candidate.key === entry.key);
        return row !== undefined && !same(entry.requires, row.requires);
      })
      .map((entry) => entry.key),
  };
}

// Anything in the check that means code and Central disagree in a way someone has to look at.
// Not registered yet is expected before a deploy, so it does not count.
export function permissionCheckFailed(check: PermissionCheck, options: { allowRemovals?: boolean } = {}): boolean {
  return (
    check.unknownToCode.length > 0 ||
    check.requiresDiffer.length > 0 ||
    (!options.allowRemovals && check.wouldDrop.length > 0)
  );
}
