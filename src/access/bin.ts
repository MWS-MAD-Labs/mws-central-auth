#!/usr/bin/env node
import { runAccessCheck } from "./check.js";

const [command, ...rest] = process.argv.slice(2);
if (command !== "check") {
  console.error("Usage: mws-access check [--config <file>]");
  process.exit(1);
}
const flag = rest.indexOf("--config");
void runAccessCheck({ configPath: flag >= 0 ? rest[flag + 1] : undefined }).then((code) => process.exit(code));
