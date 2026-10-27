#!/usr/bin/env node
import { runAccessCheck } from "./check.js";
import { runDoctor } from "./doctor.js";

const usage = "Usage: mws-access check [--config <file>]\n       mws-access doctor [--config <file>] [--env-file <file>] [--url <app address>] [--me-path <path>]";
const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const at = rest.indexOf(name);
  return at >= 0 ? rest[at + 1] : undefined;
};
if (command === "check") {
  void runAccessCheck({ configPath: option("--config") }).then((code) => process.exit(code));
} else if (command === "doctor") {
  void runDoctor({ configPath: option("--config"), envFile: option("--env-file"), url: option("--url"), mePath: option("--me-path") }).then((code) => process.exit(code));
} else {
  console.error(usage);
  process.exit(1);
}
