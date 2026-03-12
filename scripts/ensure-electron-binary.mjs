#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPackageJson = require.resolve("electron/package.json");
const electronDir = path.dirname(electronPackageJson);
const installScript = path.join(electronDir, "install.js");

const result = spawnSync(process.execPath, [installScript], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
