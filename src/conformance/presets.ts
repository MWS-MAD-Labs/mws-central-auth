import { emptyResult, type CheckResult, type ManifestEntry, type RolePreset } from "./types.js";

// AS-13 and AS-5: the starting roles only use permissions of the manifest, carry what those permissions need, and no
// two of them have exactly the same permissions.
export function checkPresets(presets: readonly RolePreset[], manifest: readonly ManifestEntry[]): CheckResult {
  const result = emptyResult();
  const known = new Set(manifest.map((entry) => entry.key));
  const requires = new Map(manifest.map((entry) => [entry.key, entry.requires ?? []] as const));
  const roleKeys = new Set<string>();
  const seenSets = new Map<string, string>();

  for (const preset of presets) {
    if (roleKeys.has(preset.key)) result.problems.push({ rule: "AS-13", message: `Role "${preset.key}" is listed more than once.` });
    roleKeys.add(preset.key);
    if (preset.permissions.length === 0) result.problems.push({ rule: "AS-13", message: `Role "${preset.key}" has no permissions.` });
    const carried = new Set(preset.permissions);
    for (const key of carried) {
      if (!known.has(key)) result.problems.push({ rule: "AS-13", message: `Role "${preset.key}" carries "${key}", which is not in the manifest.` });
    }
    for (const key of carried) {
      for (const needed of requires.get(key) ?? []) {
        if (!carried.has(needed)) result.problems.push({ rule: "AS-4", message: `Role "${preset.key}" carries "${key}" without "${needed}".` });
      }
    }
    const signature = [...carried].sort().join("\n");
    const twin = seenSets.get(signature);
    if (twin && carried.size > 0) result.problems.push({ rule: "AS-5", message: `Roles "${twin}" and "${preset.key}" have exactly the same permissions.` });
    else seenSets.set(signature, preset.key);
  }
  return result;
}
