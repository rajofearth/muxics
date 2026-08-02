// Scenario runner (issue #41) — executes catalog scenarios end to end through
// the driver: real UI interactions + the session-validated readiness gate
// (design §3.1, §3.4). #41 wires the startup pair (§4.1):
//
//   startup.cold — fresh scratch copy of the real app-data dir with the
//                  app-level disk caches emptied (§5 `cold`); first launch.
//   startup.warm — the SAME scratch copy relaunched immediately; app disk
//                  caches present → hydrate-from-cache + delta-sync (§5 `warm`).
//
// Cold and warm therefore differ exactly in app-level cache state, and both go
// through the same readiness gate (a run landing in local-only mode is aborted
// and never yields a trace). Each trace carries the data manifest — music
// folders + file counts, playlist count, session validity, cache sizes — in
// its meta (design §5, grilling Q4).
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import type { BenchDataManifest, BenchTrace } from "../../src/shared/bench-contract";
import {
  computeDataManifest,
  createColdScratch,
  prepareLaunchChain,
  runLaunchCycle,
  teardown,
} from "../driver/driver";
import { getScenario, STARTUP_SCENARIO_IDS } from "../scenarios/catalog";

export interface ScenarioRunOptions {
  /** Hide the app window (visible by default) — identical flows and trace. */
  headless?: boolean;
  /** Scenario ids to run; defaults to the startup pair. */
  scenarios?: string[];
}

export interface ScenarioRunResult {
  scenarioId: string;
  /** Batch run id — the scratch dir id shared by all runs of the batch. */
  runId: string;
  tracePath: string;
  trace: BenchTrace;
  /** The manifest attached to trace.meta.dataManifest. */
  manifest: BenchDataManifest;
}

/** Context an executor needs — shared across the runs of one batch. */
interface RunnerContext {
  repoRoot: string;
  /** Same scratch root for cold AND the warm relaunch (§4.1). */
  scratchRoot: string;
  /** <scratchRoot>/<appDataDirName> — the copied profile the app launches against. */
  appDataDir: string;
  musicFolders: Array<{ path: string; audioFiles: number }>;
  headless: boolean;
  runId: string;
}

// Executors wired so far: the startup pair. Each builds the data manifest for
// its cache profile before launch (sizes = the state the run starts from),
// then launches through the driver, which stamps manifest.sessionValid after
// the readiness gate passes and attaches the manifest to the trace (§5 Q4).
const EXECUTORS: Record<
  string,
  (ctx: RunnerContext) => Promise<ScenarioRunResult>
> = {
  "startup.cold": async (ctx) => runStartupProfile(ctx, "cold"),
  "startup.warm": async (ctx) => runStartupProfile(ctx, "warm"),
};

async function runStartupProfile(
  ctx: RunnerContext,
  cacheProfile: "cold" | "warm",
): Promise<ScenarioRunResult> {
  const manifest = computeDataManifest({
    appDataDir: ctx.appDataDir,
    musicFolders: ctx.musicFolders,
    cacheProfile,
    sessionValid: false, // stamped true by runLaunchCycle after readiness
  });
  const result = await runLaunchCycle({
    repoRoot: ctx.repoRoot,
    scratchRoot: ctx.scratchRoot,
    headless: ctx.headless,
    manifest,
  });
  return {
    scenarioId: `startup.${cacheProfile}`,
    runId: ctx.runId,
    tracePath: result.tracePath,
    trace: result.trace,
    manifest: result.trace.meta.dataManifest ?? manifest,
  };
}

export async function runScenarios(
  options: ScenarioRunOptions = {},
): Promise<ScenarioRunResult[]> {
  const headless =
    options.headless ?? process.env["MUXICS_BENCH_HEADLESS"] === "1";
  const scenarioIds = options.scenarios ?? [...STARTUP_SCENARIO_IDS];
  for (const id of scenarioIds) {
    getScenario(id); // validate ids up front — a typo fails before any launch
    if (!EXECUTORS[id]) {
      throw new Error(
        `Scenario "${id}" has no executor yet — #41 wires only the startup pair (${STARTUP_SCENARIO_IDS.join(", ")}).`,
      );
    }
  }

  let vite: ChildProcess | null = null;
  let scratchRoot: string | null = null;
  const results: ScenarioRunResult[] = [];

  try {
    // Pre-flight + tsup build + one Vite child serve the whole batch (§3.1).
    const chain = await prepareLaunchChain();
    vite = chain.vite;
    const runId = new Date().toISOString().replace(/[:.]/g, "-");

    // Cold profile: fresh scratch copy with app-level caches emptied (§5).
    const scratch = createColdScratch(
      chain.repoRoot,
      chain.report.appDataDir,
      runId,
    );
    scratchRoot = scratch.scratchRoot;

    const ctx: RunnerContext = {
      repoRoot: chain.repoRoot,
      scratchRoot: scratch.scratchRoot,
      appDataDir: path.join(scratch.scratchRoot, scratch.appDataDirName),
      musicFolders: chain.report.musicFolders,
      headless,
      runId,
    };

    for (const id of scenarioIds) {
      console.log(`[bench:runner] scenario ${id} starting...`);
      results.push(await EXECUTORS[id](ctx));
      const manifest = results[results.length - 1].manifest;
      console.log(
        `[bench:runner] scenario ${id} done — trace ${results[results.length - 1].tracePath} (${manifest.cacheProfile}, ${manifest.playlistCount} playlists, sessionValid=${manifest.sessionValid})`,
      );
    }
    return results;
  } finally {
    // One teardown for the whole batch — cold and warm share the scratch copy.
    await teardown(vite, scratchRoot);
  }
}
