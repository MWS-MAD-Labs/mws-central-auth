import { checkManifest } from "../conformance/manifest.js";
import type { ManifestEntry } from "../conformance/types.js";

export interface PermissionInput {
  key: string;
  description: string;
  requires?: readonly string[];
}

export class AccessDefinitionError extends Error {
  constructor(readonly problems: string[]) {
    super(`The permissions of the application do not follow the Access Standard:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "AccessDefinitionError";
  }
}

export interface PermissionSet<Key extends string> {
  application: string;
  // What the application sends to Central with permissions:sync.
  manifest: ManifestEntry[];
  keys: readonly Key[];
  has(key: string): key is Key;
}

// The one place an application lists its permissions (Access Standard AS-3, AS-4). It checks the list when the module is
// loaded, so a key in the wrong shape, a missing `<application>.use`, a dangling `requires` or a `manage` without its `read`
// stops the app at start and in tests, not in review.
export function definePermissions<const List extends readonly PermissionInput[]>(definition: {
  application: string;
  permissions: List;
  // Keys registered before the standard format that are still being renamed (AS-14). They only warn.
  legacyKeys?: readonly string[];
}): PermissionSet<List[number]["key"]> {
  const manifest: ManifestEntry[] = definition.permissions.map((entry) => ({
    key: entry.key,
    description: entry.description,
    ...(entry.requires?.length ? { requires: [...entry.requires] } : {}),
  }));
  const result = checkManifest(manifest, { application: definition.application, legacyKeys: definition.legacyKeys });
  const missingDescriptions = definition.permissions.filter((entry) => !entry.description?.trim()).map((entry) => `${entry.key} has no description.`);
  const problems = [...result.problems.map((finding) => `${finding.rule}: ${finding.message}`), ...missingDescriptions.map((message) => `AS-4: ${message}`)];
  if (problems.length > 0) throw new AccessDefinitionError(problems);
  const keys = manifest.map((entry) => entry.key) as List[number]["key"][];
  const known = new Set<string>(keys);
  return { application: definition.application, manifest, keys, has: (key): key is List[number]["key"] => known.has(key) };
}

// The same two questions in every app (AS-2, AS-6). A missing list is the same as no permissions.
export function can<Key extends string>(granted: readonly string[] | undefined, key: Key): boolean {
  return Boolean(granted?.includes(key));
}

export function canAny(granted: readonly string[] | undefined, wanted: readonly string[]): boolean {
  return wanted.some((key) => can(granted, key));
}
