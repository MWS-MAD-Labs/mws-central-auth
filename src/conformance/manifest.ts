import { isStandardPermissionKey } from "./keys.js";
import { emptyResult, type CheckResult, type ManifestEntry } from "./types.js";

export interface ManifestOptions {
  // The application id, which has to have `<application>.use` (AS-3).
  application: string;
  // Keys that were registered before the standard format and are still being renamed (AS-14). They only warn.
  legacyKeys?: readonly string[];
}

// AS-3 and AS-4: the keys follow the format, are unique, `requires` points inside the manifest without loops, `manage`
// needs `read`, and the application has its `.use` permission.
export function checkManifest(manifest: readonly ManifestEntry[], options: ManifestOptions): CheckResult {
  const result = emptyResult();
  const legacy = new Set(options.legacyKeys ?? []);
  const keys = manifest.map((entry) => entry.key);
  const known = new Set(keys);

  if (keys.length === 0) result.problems.push({ rule: "AS-4", message: "The manifest is empty." });
  for (const key of new Set(keys.filter((candidate, index) => keys.indexOf(candidate) !== index))) {
    result.problems.push({ rule: "AS-4", message: `"${key}" is listed more than once.` });
  }
  for (const key of new Set(keys)) {
    if (!isStandardPermissionKey(key)) {
      const finding = { rule: "AS-3", message: `"${key}" is not domain.action (lowercase words joined by dots, 2 or 3 levels, up to 64 characters).` };
      (legacy.has(key) ? result.warnings : result.problems).push(finding);
    }
  }
  if (keys.length > 0 && !known.has(`${options.application}.use`)) {
    result.problems.push({ rule: "AS-3", message: `The manifest has no "${options.application}.use" permission to sign in.` });
  }

  const requires = new Map<string, string[]>();
  for (const entry of manifest) requires.set(entry.key, [...(requires.get(entry.key) ?? []), ...(entry.requires ?? [])]);
  for (const entry of manifest) {
    for (const needed of entry.requires ?? []) {
      if (needed === entry.key) result.problems.push({ rule: "AS-4", message: `"${entry.key}" needs itself.` });
      else if (!known.has(needed)) result.problems.push({ rule: "AS-4", message: `"${entry.key}" needs "${needed}", which is not in the manifest.` });
    }
  }
  for (const key of requires.keys()) {
    if (closure(key, requires).has(key) && !(requires.get(key) ?? []).includes(key)) {
      result.problems.push({ rule: "AS-4", message: `"${key}" needs itself through the permissions it requires.` });
    }
  }
  for (const key of keys.filter((candidate) => candidate.endsWith(".manage"))) {
    const read = `${key.slice(0, -".manage".length)}.read`;
    if (!closure(key, requires).has(read)) {
      result.problems.push({ rule: "AS-3", message: `"${key}" should need "${read}" in requires.` });
    }
  }
  return result;
}

function closure(key: string, requires: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...(requires.get(key) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(requires.get(next) ?? []));
  }
  return seen;
}
