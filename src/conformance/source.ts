import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { STANDARD_PERMISSION_KEY } from "./keys.js";
import { emptyResult, type CheckResult, type ManifestEntry } from "./types.js";

export interface ScanOptions {
  // Folders to read, such as ["apps/api/src", "apps/web/src"].
  roots: readonly string[];
  extensions?: readonly string[];
  // Path fragments to skip. Tests and build output are skipped unless you change this.
  ignore?: readonly RegExp[];
}

const DEFAULT_IGNORE = [/node_modules/, /(^|\/)dist\//, /\.test\.[cm]?[jt]sx?$/, /\.d\.ts$/];

async function* walk(root: string, options: Required<Pick<ScanOptions, "extensions" | "ignore">>, base: string): AsyncGenerator<{ file: string; path: string }> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    const shown = relative(base, full).split(sep).join("/");
    if (options.ignore.some((pattern) => pattern.test(shown))) continue;
    if (entry.isDirectory()) yield* walk(full, options, base);
    else if (options.extensions.some((extension) => entry.name.endsWith(extension))) yield { file: shown, path: full };
  }
}

async function readSources(options: ScanOptions, cwd: string) {
  const settings = { extensions: options.extensions ?? [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], ignore: options.ignore ?? DEFAULT_IGNORE };
  const files: Array<{ file: string; text: string }> = [];
  for (const root of options.roots) {
    for await (const item of walk(join(cwd, root), settings, cwd)) files.push({ file: item.file, text: await readFile(item.path, "utf8") });
  }
  return files;
}

export interface UsageOptions extends ScanOptions {
  manifest: readonly ManifestEntry[];
  // Files that declare the manifest itself (they list every key, so they say nothing about use).
  manifestFiles: readonly string[];
  cwd?: string;
}

const LITERAL = /(['"`])([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,2})\1/g;

// AS-6 and AS-7: a permission written in the code that looks like one of the application's domains but is not in the
// manifest is a typo, and a manifest key nothing asks for is probably dead. Uses string literals, so it also reads
// the web code that shares the constants.
export async function checkPermissionUsage(options: UsageOptions): Promise<CheckResult> {
  const result = emptyResult();
  const known = new Set(options.manifest.map((entry) => entry.key));
  const domains = new Set(options.manifest.map((entry) => entry.key.split(".")[0]));
  const used = new Set<string>();
  for (const { file, text } of await readSources(options, options.cwd ?? process.cwd())) {
    if (options.manifestFiles.some((declared) => file === declared || file.endsWith(`/${declared}`))) continue;
    for (const match of text.matchAll(LITERAL)) {
      const key = match[2] as string;
      if (known.has(key)) used.add(key);
      else if (domains.has(key.split(".")[0]) && STANDARD_PERMISSION_KEY.test(key)) {
        result.problems.push({ rule: "AS-6", message: `${file} asks for "${key}", which is not in the manifest.` });
      }
    }
  }
  for (const key of known) {
    if (!used.has(key)) result.warnings.push({ rule: "AS-7", message: `"${key}" is in the manifest but no code asks for it.` });
  }
  return result;
}

export interface RoleNameOptions extends ScanOptions {
  // The role names to look for, such as ["ADMINISTRATOR", "FACILITIES_MANAGER"].
  roleNames: readonly string[];
  // Files where a role name is allowed, such as a display label or an audit event name.
  allow?: ReadonlyArray<{ file: string; reason: string }>;
  cwd?: string;
}

// AS-2: no role name in the logic. Every hit outside the allowed files is a problem.
export async function checkNoRoleNames(options: RoleNameOptions): Promise<CheckResult> {
  const result = emptyResult();
  if (options.roleNames.length === 0) return result;
  const pattern = new RegExp(`\\b(${options.roleNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`);
  for (const { file, text } of await readSources(options, options.cwd ?? process.cwd())) {
    if (options.allow?.some((entry) => file === entry.file || file.endsWith(`/${entry.file}`))) continue;
    text.split("\n").forEach((line, index) => {
      const hit = pattern.exec(line);
      if (hit) result.problems.push({ rule: "AS-2", message: `${file}:${index + 1} mentions the role "${hit[1]}".` });
    });
  }
  return result;
}
