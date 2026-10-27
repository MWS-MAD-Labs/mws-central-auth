// A finding of a conformance check. `rule` is the number in the MWS Access Standard (mws-data-center/docs/access-standard.md).
export interface Finding {
  rule: string;
  message: string;
}

// Problems fail the check. Warnings are worth a look but do not fail it.
export interface CheckResult {
  problems: Finding[];
  warnings: Finding[];
}

export interface ManifestEntry {
  key: string;
  description?: string;
  requires?: readonly string[];
}

export interface RolePreset {
  key: string;
  label?: string;
  permissions: readonly string[];
}

export function emptyResult(): CheckResult {
  return { problems: [], warnings: [] };
}

export function mergeResults(...results: CheckResult[]): CheckResult {
  return {
    problems: results.flatMap((result) => result.problems),
    warnings: results.flatMap((result) => result.warnings),
  };
}

export function formatFindings(result: CheckResult): string {
  const line = (finding: Finding) => `  ${finding.rule}: ${finding.message}`;
  return [
    ...result.problems.map((finding) => `problem ${line(finding).trimStart()}`),
    ...result.warnings.map((finding) => `warning ${line(finding).trimStart()}`),
  ].join("\n");
}

// For a test: throws with every problem listed, so one run shows them all. Warnings are only listed when something failed.
export function assertConformance(result: CheckResult): void {
  if (result.problems.length === 0) return;
  throw new Error(`Access Standard conformance failed:\n${formatFindings(result)}`);
}
