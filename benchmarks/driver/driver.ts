// Muxics benchmark driver (issue #40) — launches the dev app end-to-end,
// verifies it (pre-flight + readiness gate), and collects one v1 bench trace.
//
// Locked design: docs/benchmarks/design.md §3 (driver mechanics) and §5.1
// (prerequisites). The scenario runner (#41) builds on this module.
//
// The driver orchestrates the pieces `pnpm dev` hides (design §3.1): builds
// the Electron entrypoints with tsup, starts the Vite dev server as a child,
// launches Electron against a read-only copy of the real app-data dir (APPDATA
// override, §3.2), waits for the readiness gate (§3.1), then closes and
// collects the trace from benchmarks/runs/ (§3.3).
import { _electron } from "playwright";
import type { ElectronApplication } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_DATA_ID,
  AUDIO_EXTENSIONS,
  AUDIO_SERVER_PORT,
  LEGACY_APP_DATA_IDS,
} from "../../src/shared/constants";
import type { BenchTrace } from "../../src/shared/bench-contract";

const VITE_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${VITE_PORT}`;
const AUDIO_SERVER_HOST = "127.0.0.1";
const SCRATCH_ROOT_REL = path.join("benchmarks", "scratch");
const RUNS_DIR_REL = path.join("benchmarks", "runs");
const TAG = "[bench:driver]";

export interface DriverOptions {
  /** Hide the app window (visible by default) — identical flows and trace. */
  headless?: boolean;
}

export interface DriverResult {
  runId: string;
  headless: boolean;
  tracePath: string;
  trace: BenchTrace;
  /** Captured main-process stdout lines (diagnostics). */
  appStdout: string[];
  /** Captured main-process stderr lines (diagnostics). */
  appStderr: string[];
}

/** Structured run failure. `reason` mirrors the design's failure taxonomy. */
export class DriverFailure extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "DriverFailure";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tail(text: string, lines: number): string {
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot(): string {
  let dir = MODULE_DIR;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new DriverFailure(
    "preflight",
    "Could not locate the repo root (package.json) above the driver module.",
  );
}

/** Mirrors src/electron/backend/paths.ts — the config root (%APPDATA%). */
export function resolveConfigRoot(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return path.join(home, ".config");
}

/** Mirrors src/electron/backend/paths.ts — the dir the app actually uses. */
export function resolveRealAppDataDir(): string {
  const configRoot = resolveConfigRoot();
  for (const candidate of [APP_DATA_ID, ...LEGACY_APP_DATA_IDS]) {
    const candidatePath = path.join(configRoot, candidate);
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return path.join(configRoot, APP_DATA_ID);
}

/**
 * The app's Chromium profile dir name = the package.json "name" (Electron's
 * default userData). safeStorage on Electron ≥15 uses Chromium OSCrypt, whose
 * key lives in <userData>/Local State — not raw DPAPI on the payload.
 */
function readAppUserDataDirName(repoRoot: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { name?: string };
    if (typeof pkg.name === "string" && pkg.name.length > 0) return pkg.name;
  } catch {
    // fall through to the known default
  }
  return "muxics";
}

// ---------------------------------------------------------------------------
// Port probes
// ---------------------------------------------------------------------------

function isPortOpen(port: number, host = AUDIO_SERVER_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1500);
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function isPortFree(port: number, host = AUDIO_SERVER_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host }, () => server.close(() => resolve(true)));
  });
}

async function waitForPortOpen(
  port: number,
  timeoutMs: number,
  host = AUDIO_SERVER_HOST,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port, host)) return;
    await sleep(500);
  }
  throw new DriverFailure(
    "preflight",
    `Port ${host}:${port} did not open within ${timeoutMs}ms.`,
  );
}

/** Polls until the probe returns something other than "pending". */
async function waitForOutcome(
  probe: () => Promise<"pending" | string>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outcome = await probe();
    if (outcome !== "pending") return outcome;
    await sleep(intervalMs);
  }
  return "pending";
}

// ---------------------------------------------------------------------------
// Pre-flight (design §5.1) — fail fast, name the missing prerequisite
// ---------------------------------------------------------------------------

export interface PreflightReport {
  repoRoot: string;
  appDataDir: string;
  musicDirs: string[];
  ytDlpPath: string;
}

function failPreflight(what: string, fix: string): never {
  throw new DriverFailure("preflight", `${what}\n  Fix: ${fix}`);
}

function countAudioFiles(root: string, maxEntries = 200_000): number {
  let count = 0;
  let visited = 0;
  const stack = [root];
  while (stack.length > 0 && visited < maxEntries) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited++;
      if (entry.isDirectory()) {
        stack.push(path.join(dir, entry.name));
      } else if (
        entry.isFile() &&
        AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        count++;
      }
    }
  }
  return count;
}

function readWatchFolders(appDataDir: string): string[] {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(appDataDir, "settings.json"), "utf8"),
    ) as { watchFolders?: unknown };
    return Array.isArray(parsed.watchFolders)
      ? parsed.watchFolders.filter((f): f is string => typeof f === "string")
      : [];
  } catch {
    return [];
  }
}

export async function preflight(repoRoot: string): Promise<PreflightReport> {
  // 1. Toolchain (§5.1.5).
  if (!fs.existsSync(path.join(repoRoot, "node_modules"))) {
    failPreflight(
      "node_modules is missing.",
      "Run `pnpm install` in the repo root first.",
    );
  }
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteBin)) {
    failPreflight(
      `Vite is not installed (missing ${viteBin}).`,
      "Run `pnpm install`.",
    );
  }
  const tsupCli = path.join(
    repoRoot,
    "node_modules",
    "tsup",
    "dist",
    "cli-default.js",
  );
  if (!fs.existsSync(tsupCli)) {
    failPreflight(
      `tsup is not installed (missing ${tsupCli}).`,
      "Run `pnpm install`.",
    );
  }

  // 2. Ports (§5.1.3 + §3.1 step 3): both are hard requirements — the audio
  // server bind kills startup, Vite's strictPort refuses to start.
  if (!(await isPortFree(AUDIO_SERVER_PORT))) {
    failPreflight(
      `Audio-server port ${AUDIO_SERVER_HOST}:${AUDIO_SERVER_PORT} is already in use.`,
      "Close the running Muxics instance (it hard-binds this port before window creation).",
    );
  }
  if (!(await isPortFree(VITE_PORT))) {
    failPreflight(
      `Vite port ${AUDIO_SERVER_HOST}:${VITE_PORT} is already in use.`,
      "Stop any other dev server on port 5173 (Vite uses strictPort and refuses to start).",
    );
  }

  // 3. App-data dir + session — cheap pre-launch guard; the authoritative
  // check is the post-launch readiness gate (§3.1).
  const appDataDir = resolveRealAppDataDir();
  if (!fs.existsSync(appDataDir)) {
    failPreflight(
      `No app-data dir at ${appDataDir}.`,
      "Launch the app once and log into YouTube Music (or import a session) so a session exists.",
    );
  }
  const sessionPath = path.join(appDataDir, "ytmusic", "session.json");
  if (!fs.existsSync(sessionPath)) {
    failPreflight(
      `No YouTube Music session at ${sessionPath}.`,
      "Log into YouTube Music inside the app once (Settings → connect), then re-run the driver.",
    );
  }
  try {
    const session = JSON.parse(
      fs.readFileSync(sessionPath, "utf8"),
    ) as { value?: unknown };
    if (typeof session.value !== "string" || session.value.length === 0) {
      failPreflight(
        `Session file ${sessionPath} has no usable credential.`,
        "Re-import your YouTube Music session from the browser extension, then re-run.",
      );
    }
  } catch (err) {
    failPreflight(
      `Session file ${sessionPath} is not valid JSON (${
        err instanceof Error ? err.message : String(err)
      }).`,
      "Re-import your YouTube Music session from the browser extension.",
    );
  }

  // 4. Real music files (§5.1.1): default music folder + watch folders.
  const candidates = new Set<string>();
  if (process.platform === "win32") {
    candidates.add(
      path.join(process.env["USERPROFILE"] ?? os.homedir(), "Music"),
    );
  } else {
    candidates.add(path.join(os.homedir(), "Music"));
  }
  for (const folder of readWatchFolders(appDataDir)) candidates.add(folder);
  const musicDirs: string[] = [];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const count = countAudioFiles(dir);
    if (count > 0) musicDirs.push(`${dir} (${count} audio files)`);
  }
  if (musicDirs.length === 0) {
    failPreflight(
      "No real audio files found in the default music folder or watch folders.",
      `Put audio files in ${[...candidates].join(" / ")} (or add a watch folder in the app's settings).`,
    );
  }

  // 5. yt-dlp (§5.1.4) — pre-placed in the copy to avoid a mid-run download.
  const ytDlpPath = path.join(
    appDataDir,
    "ytmusic",
    "tools",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  );
  if (!fs.existsSync(ytDlpPath)) {
    failPreflight(
      `yt-dlp is missing at ${ytDlpPath}.`,
      "Play one remote track in the app once so it downloads yt-dlp into ytmusic\\tools\\, or copy yt-dlp.exe there yourself.",
    );
  }

  // 5b. safeStorage profile key (design gap surfaced by #40): the stored
  // session is encrypted with the Chromium profile's OSCrypt key
  // (<userData>/Local State), not raw DPAPI. The scratch APPDATA has no
  // profile, so without this key the copied session cannot decrypt and the
  // readiness gate would fail with session-not-logged-in. Fail fast instead.
  const userDataDirName = readAppUserDataDirName(repoRoot);
  const localStatePath = path.join(
    resolveConfigRoot(),
    userDataDirName,
    "Local State",
  );
  if (!fs.existsSync(localStatePath)) {
    failPreflight(
      `No safeStorage profile key at ${localStatePath}.`,
      "Launch the app once normally (not through the driver) so its Chromium profile and OSCrypt key are created, then re-run.",
    );
  }

  return {
    repoRoot,
    appDataDir,
    musicDirs,
    ytDlpPath,
  };
}

// ---------------------------------------------------------------------------
// Launch chain (design §3.1) — tsup → Vite child → Electron
// ---------------------------------------------------------------------------

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(
  executable: string,
  args: string[],
  opts: { cwd: string; label: string; timeoutMs?: number },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout = (stdout + String(d)).slice(-32 * 1024);
    });
    child.stderr?.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-32 * 1024);
    });
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            child.kill();
            reject(
              new DriverFailure(
                "preflight",
                `${opts.label} timed out after ${opts.timeoutMs}ms.`,
              ),
            );
          }, opts.timeoutMs)
        : null;
    child.once("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new DriverFailure("preflight", `${opts.label} failed to start: ${err.message}`),
      );
    });
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function buildElectronEntrypoints(repoRoot: string): Promise<void> {
  const tsupCli = path.join(
    repoRoot,
    "node_modules",
    "tsup",
    "dist",
    "cli-default.js",
  );
  console.log(`${TAG} building Electron entrypoints (tsup)...`);
  const result = await runCommand(
    process.execPath,
    [tsupCli, "--config", "tsup.electron.config.ts"],
    { cwd: repoRoot, label: "tsup build", timeoutMs: 180_000 },
  );
  if (result.code !== 0) {
    throw new DriverFailure(
      "preflight",
      `tsup build exited with code ${result.code}.\n${tail(result.stderr, 20)}`,
    );
  }
}

async function startVite(repoRoot: string): Promise<ChildProcess> {
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  console.log(`${TAG} starting Vite dev server on 127.0.0.1:${VITE_PORT}...`);
  const child = spawn(process.execPath, [viteBin, "--port", String(VITE_PORT)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr = (stderr + String(d)).slice(-32 * 1024);
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once("close", (code) => resolve(code)),
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(VITE_PORT)) return child;
    const code = await Promise.race([
      exited,
      sleep(500).then(() => null as number | null),
    ]);
    if (code !== null) {
      throw new DriverFailure(
        "preflight",
        `Vite exited early (code ${code}) before binding port ${VITE_PORT}.\n${tail(stderr, 20)}`,
      );
    }
  }
  throw new DriverFailure(
    "preflight",
    `Vite did not bind 127.0.0.1:${VITE_PORT} within 60s.\n${tail(stderr, 20)}`,
  );
}

// ---------------------------------------------------------------------------
// Read-only session strategy (design §3.2) — copy, don't freeze
// ---------------------------------------------------------------------------

function buildScratchCopy(
  repoRoot: string,
  appDataDir: string,
  runId: string,
): string {
  const scratchRoot = path.join(repoRoot, SCRATCH_ROOT_REL, runId);
  fs.mkdirSync(scratchRoot, { recursive: true });
  const dest = path.join(scratchRoot, path.basename(appDataDir));
  console.log(`${TAG} copying app-data ${appDataDir} → ${dest}`);
  fs.cpSync(appDataDir, dest, { recursive: true });

  // Carry the safeStorage key into the scratch Chromium profile. The session
  // is encrypted with OSCrypt (Electron ≥15) using the key in the real
  // profile's Local State; a fresh profile would generate a new key and the
  // copied session would not decrypt (design §3.2 "session decrypts on copy"
  // — surfaced as a gap by #40).
  const userDataDirName = readAppUserDataDirName(repoRoot);
  const realLocalState = path.join(
    resolveConfigRoot(),
    userDataDirName,
    "Local State",
  );
  if (fs.existsSync(realLocalState)) {
    const scratchUserData = path.join(scratchRoot, userDataDirName);
    const scratchLocalState = path.join(scratchUserData, "Local State");
    fs.mkdirSync(scratchUserData, { recursive: true });
    fs.copyFileSync(realLocalState, scratchLocalState);
    console.log(`${TAG} copied safeStorage key → ${scratchLocalState}`);
  }
  return scratchRoot;
}

// ---------------------------------------------------------------------------
// Launch + readiness gate (design §3.1)
// ---------------------------------------------------------------------------

async function launchApp(
  repoRoot: string,
  scratchRoot: string,
  headless: boolean,
): Promise<ElectronApplication> {
  console.log(
    `${TAG} launching Electron (${headless ? "headless" : "visible"}) against ${scratchRoot}...`,
  );
  return _electron.launch({
    args: ["."],
    cwd: repoRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: DEV_SERVER_URL,
      MUXICS_BENCH: "1",
      MUXICS_BENCH_HEADLESS: headless ? "1" : "0",
      APPDATA: scratchRoot,
    },
  });
}

function captureStdout(app: ElectronApplication): string[] {
  const lines: string[] = [];
  const stdout = app.process().stdout;
  if (stdout) {
    stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) lines.push(line);
      }
    });
  }
  return lines;
}

function captureStderr(app: ElectronApplication): string[] {
  const lines: string[] = [];
  const stderr = app.process().stderr;
  if (stderr) {
    stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) lines.push(line);
      }
    });
  }
  return lines;
}

/** Last raw app output lines — they name the real failure (auth restore
 * errors, sync rejections, yt-dlp issues). Console.error objects print on
 * continuation lines without the `[muxics:` prefix, so keep raw lines. */
function lastAppLines(stdout: string[], stderr: string[]): string[] {
  return [...stderr, ...stdout].slice(-60);
}

async function waitForReadiness(app: ElectronApplication): Promise<void> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });

  // Bridge up — preload exposed the desktop bridge.
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          muxicsDesktop?: { request?: { authGetStatus?: unknown } };
        }
      ).muxicsDesktop?.request?.authGetStatus !== undefined,
    undefined,
    { timeout: 30_000 },
  );

  // Audio server bound — the app awaited startAudioServer before creating the
  // window, so this is a cheap confirmation the app got past that gate.
  await waitForPortOpen(AUDIO_SERVER_PORT, 60_000);

  // Splash dismissed (initSession done) OR stranded on the signed-out /
  // session-rejected splash — the latter is a failed run (§3.1).
  //
  // The app self-heals a stale session: sync rejection → session recovery →
  // the browser extension pushes a fresh cookie (bridge /bridge/session-status
  // reports needsRefresh; extension alarms every 30s, fast-polls every 10s).
  // So "Session Expired" (recovering) is PENDING — only terminal states abort:
  // "Signed Out of YouTube Music" (recovery timed out) and the guest-mode
  // "Sign in to YouTube Music" home feed.
  const splashOutcome = await waitForOutcome(
    () =>
      page.evaluate(() => {
        const text = document.body?.innerText ?? "";
        if (
          text.includes("Signed Out of YouTube Music") ||
          text.includes("Sign in to YouTube Music")
        ) {
          return "signed-out";
        }
        if (text.includes("Session Expired")) return "pending"; // recovering
        return document.querySelector("main") ? "ready" : "pending";
      }),
    180_000,
  );
  if (splashOutcome === "signed-out") {
    throw new DriverFailure(
      "session-not-logged-in",
      "The app reached the terminal Signed Out state (session recovery timed out). " +
        "Send a fresh YouTube Music session from the browser extension " +
        "(open the extension popup while the app is running), then re-run.",
    );
  }
  if (splashOutcome !== "ready") {
    throw new DriverFailure(
      "readiness-timeout",
      "The app did not reach the main window within 180s.",
    );
  }

  // Gate A — genuinely logged in. Local-only mode is a failed run, never a
  // valid trace (design §3.1).
  const authStatus = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        muxicsDesktop?: {
          request: {
            authGetStatus: () => Promise<{
              loggedIn: boolean;
              error?: string;
            }>;
          };
        };
      }
    ).muxicsDesktop;
    return bridge ? bridge.request.authGetStatus() : null;
  });
  if (!authStatus) {
    throw new DriverFailure(
      "readiness-timeout",
      "authGetStatus is not available on the page bridge.",
    );
  }
  if (!authStatus.loggedIn) {
    throw new DriverFailure(
      "session-not-logged-in",
      `authGetStatus → loggedIn=false${
        authStatus.error ? ` (${authStatus.error})` : ""
      }. The run landed in local-only mode — its trace is never a valid baseline.`,
    );
  }

  // Gate B — drive to the homepage and verify real home-feed items render
  // (the search view shows HomeFeed when the query is empty).
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("app-navigate", { detail: "search" }));
  });
  const feedOutcome = await waitForOutcome(
    () =>
      page.evaluate(() => {
        const text = document.body?.innerText ?? "";
        if (text.includes("Sign in to YouTube Music")) return "signed-out";
        return document.querySelectorAll("main section").length > 0
          ? "rendered"
          : "pending";
      }),
    90_000,
  );
  if (feedOutcome === "signed-out") {
    throw new DriverFailure(
      "session-not-logged-in",
      "Homepage shows the sign-in state — no real YouTube content rendered.",
    );
  }
  if (feedOutcome !== "rendered") {
    throw new DriverFailure(
      "home-feed-unavailable",
      "Home feed did not render real sections within 90s.",
    );
  }
  console.log(`${TAG} readiness gate passed — logged in and home feed rendered.`);
}

// ---------------------------------------------------------------------------
// Trace collection (design §3.3)
// ---------------------------------------------------------------------------

function listRunFiles(runsDir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(runsDir));
  } catch {
    return new Set();
  }
}

function findTracePathInStdout(lines: string[]): string | null {
  let found: string | null = null;
  for (const line of lines) {
    if (!line.includes("trace written")) continue;
    const match = line.match(/(\S+\.json)\s*$/);
    if (match) found = match[1];
  }
  return found;
}

function validateTrace(trace: BenchTrace): string[] {
  const problems: string[] = [];
  if (trace.schemaVersion !== 1) {
    problems.push(`schemaVersion is ${String(trace.schemaVersion)}, expected 1`);
  }
  if (trace.meta?.appName !== "muxics") {
    problems.push(`meta.appName is ${String(trace.meta?.appName)}`);
  }
  if (!Array.isArray(trace.ipc)) problems.push("ipc is not an array");
  if (!Array.isArray(trace.marks)) problems.push("marks is not an array");
  if (!Array.isArray(trace.measures)) problems.push("measures is not an array");
  if (
    typeof trace.generatedAt !== "string" ||
    Number.isNaN(Date.parse(trace.generatedAt))
  ) {
    problems.push("generatedAt is missing or unparseable");
  }
  return problems;
}

async function waitForTraceFile(
  expectedPath: string | null,
  before: Set<string>,
  runsDir: string,
  timeoutMs: number,
): Promise<{ path: string; trace: BenchTrace }> {
  const deadline = Date.now() + timeoutMs;
  const tryRead = (p: string): BenchTrace | null => {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8")) as BenchTrace;
    } catch {
      return null;
    }
  };
  while (Date.now() < deadline) {
    if (expectedPath && fs.existsSync(expectedPath)) {
      const trace = tryRead(expectedPath);
      if (trace) return { path: expectedPath, trace };
    }
    const newFiles = [...listRunFiles(runsDir)].filter(
      (f) => f.endsWith(".json") && !before.has(f),
    );
    if (newFiles.length === 1) {
      const p = path.join(runsDir, newFiles[0]);
      const trace = tryRead(p);
      if (trace) return { path: p, trace };
    } else if (newFiles.length > 1) {
      throw new DriverFailure(
        "trace-missing",
        `Expected exactly one new trace, found ${newFiles.length}: ${newFiles.join(", ")}`,
      );
    }
    await sleep(500);
  }
  throw new DriverFailure(
    "trace-missing",
    "No trace file appeared in benchmarks/runs/ after app close.",
  );
}

async function closeApp(app: ElectronApplication): Promise<void> {
  const closing = app.close().catch((err) => {
    console.warn(`${TAG} app.close() rejected:`, err);
  });
  const timedOut = await Promise.race([
    closing.then(() => false),
    sleep(30_000).then(() => true),
  ]);
  if (timedOut) {
    console.warn(`${TAG} app.close() timed out — killing the process.`);
    const proc = app.process();
    if (proc.exitCode === null) proc.kill();
  }
  // Give the will-quit flush a moment to land.
  await sleep(500);
}

// ---------------------------------------------------------------------------
// Teardown — never leave a stray Vite, app, or scratch copy behind
// ---------------------------------------------------------------------------

async function teardown(
  vite: ChildProcess | null,
  scratchRoot: string | null,
): Promise<void> {
  if (vite && vite.exitCode === null) {
    vite.kill();
    const exited = new Promise<void>((resolve) =>
      vite.once("close", () => resolve()),
    );
    await Promise.race([
      exited,
      sleep(2000).then(() => {
        if (vite.exitCode === null) vite.kill("SIGKILL");
      }),
    ]);
  }
  if (scratchRoot) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
        return;
      } catch {
        // Electron may still hold file locks briefly after exit.
        await sleep(500);
      }
    }
    console.warn(
      `${TAG} could not remove scratch dir ${scratchRoot} (left in place).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runDriverCycle(
  options: DriverOptions = {},
): Promise<DriverResult> {
  const headless =
    options.headless ?? process.env["MUXICS_BENCH_HEADLESS"] === "1";
  const repoRoot = resolveRepoRoot();
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runsDir = path.join(repoRoot, RUNS_DIR_REL);
  const runFilesBefore = listRunFiles(runsDir);

  let vite: ChildProcess | null = null;
  let scratchRoot: string | null = null;
  let app: ElectronApplication | null = null;
  let appStdout: string[] = [];
  let appStderr: string[] = [];

  try {
    // 1. Pre-flight — fail fast with the missing prerequisite named (§5.1).
    const report = await preflight(repoRoot);
    console.log(`${TAG} preflight OK:`);
    console.log(`${TAG}   app-data dir: ${report.appDataDir}`);
    console.log(`${TAG}   music: ${report.musicDirs.join("; ")}`);
    console.log(`${TAG}   yt-dlp: ${report.ytDlpPath}`);

    // 2. Build Electron entrypoints — `electron .` needs dist-electron/ (§3.1).
    await buildElectronEntrypoints(repoRoot);

    // 3. Start the Vite dev server as a child.
    vite = await startVite(repoRoot);

    // 4. Snapshot the real app-data into a scratch dir — the real session is
    // never written to (§3.2).
    scratchRoot = buildScratchCopy(repoRoot, report.appDataDir, runId);

    // 5. Launch Electron against the scratch copy.
    app = await launchApp(repoRoot, scratchRoot, headless);
    appStdout = captureStdout(app);
    appStderr = captureStderr(app);

    // 6. Readiness gate — logged in + real home-feed content (§3.1).
    await waitForReadiness(app);

    // 7. Close cleanly; the renderer pagehide flush + will-quit flush write
    // the trace (single-write latch → exactly one file).
    await closeApp(app);
    app = null;

    // 8. Collect + validate the trace (§3.3).
    const expected = findTracePathInStdout(appStdout);
    const { path: tracePath, trace } = await waitForTraceFile(
      expected,
      runFilesBefore,
      runsDir,
      30_000,
    );
    const problems = validateTrace(trace);
    if (problems.length > 0) {
      throw new DriverFailure(
        "trace-invalid",
        `Trace ${tracePath} failed validation:\n  - ${problems.join("\n  - ")}`,
      );
    }
    console.log(`${TAG} trace OK: ${tracePath}`);
    console.log(
      `${TAG}   reason=${trace.reason} ipc=${trace.ipc.length} marks=${trace.marks.length} measures=${trace.measures.length}`,
    );

    return { runId, headless, tracePath, trace, appStdout, appStderr };
  } catch (err) {
    // Diagnostics first — the app's own output lines explain why a run
    // failed (auth restore errors, sync rejections, yt-dlp issues).
    const appLines = lastAppLines(appStdout, appStderr);
    if (appLines.length > 0) {
      console.error(`${TAG} last app output lines:`);
      for (const line of appLines) console.error(`  ${line}`);
    }
    // Abort handling — close the app before teardown.
    if (app) {
      try {
        await closeApp(app);
      } catch {
        // already gone
      }
    }
    if (err instanceof DriverFailure && err.reason === "session-not-logged-in") {
      // A session-not-logged-in run's trace is never a valid baseline (§3.1):
      // discard any trace this run produced so baseline tooling can't pick it up.
      const invalid = [...listRunFiles(runsDir)].filter(
        (f) => f.endsWith(".json") && !runFilesBefore.has(f),
      );
      for (const f of invalid) {
        const p = path.join(runsDir, f);
        console.warn(`${TAG} discarding invalid trace (${err.reason}): ${p}`);
        try {
          fs.rmSync(p, { force: true });
        } catch {
          // best-effort
        }
      }
    }
    throw err;
  } finally {
    // Never leave a stray Vite or scratch copy behind — success or failure
    // (design §3.2: tear down the scratch dir after the run).
    await teardown(vite, scratchRoot);
  }
}
