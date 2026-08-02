// Scenario runner (issues #41 + #42) — executes catalog scenarios end to end
// through the driver: real UI interactions + the session-validated readiness
// gate (design §3.1, §3.4). Wired so far:
//
//   startup.cold    — fresh scratch copy, app-level caches emptied (§5 cold).
//   startup.warm    — the SAME scratch copy relaunched; caches present (§5 warm).
//   library.scan    — whole-scan latency + metadata throughput (§4.2); fresh
//                     cold copy (catalog input freshScratchCopy) so the scan
//                     and the getTrackMetadata burst run with empty caches.
//   library.sync.yt — hydrate vs sync split with the real session (§4.2); runs
//                     on the warm batch copy (cache.json from the prior runs).
//   search.local    — renderer input→results over the real local library (§4.3).
//   search.remote   — ytmusicSearch IPC + results mark, source switched to
//                     YT Music through the real title-bar dropdown (§4.3).
//
// Cold and warm differ exactly in app-level cache state, and every run goes
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
import {
  openLibraryView,
  openSearchView,
  readRealTitleFragment,
  switchLibrarySource,
  typeSearch,
  waitForLibraryRows,
} from "../driver/steps";
import {
  getScenario,
  IMPLEMENTED_SCENARIO_IDS,
} from "../scenarios/catalog";

export interface ScenarioRunOptions {
  /** Hide the app window (visible by default) — identical flows and trace. */
  headless?: boolean;
  /** Scenario ids to run; defaults to every wired scenario. */
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
  /** The real app-data dir (preflight) — source for fresh scenario copies. */
  realAppDataDir: string;
  musicFolders: Array<{ path: string; audioFiles: number }>;
  headless: boolean;
  runId: string;
}

// Executors wired so far: the startup pair (#41) and the library + search
// flows (#42). Each builds the data manifest for its cache profile before
// launch (sizes = the state the run starts from), then launches through the
// driver, which stamps manifest.sessionValid after the readiness gate passes
// and attaches the manifest to the trace (§5 Q4).
const EXECUTORS: Record<
  string,
  (ctx: RunnerContext) => Promise<ScenarioRunResult>
> = {
  "startup.cold": async (ctx) => runStartupProfile(ctx, "cold"),
  "startup.warm": async (ctx) => runStartupProfile(ctx, "warm"),

  // §4.2 — whole-scan latency + metadata throughput on a FRESH cold copy
  // (catalog input freshScratchCopy): the scan and the getTrackMetadata burst
  // run during initSession; the steps open the library view and wait for the
  // virtualized list render. Burst names stay diagnostics, never pass/fail.
  "library.scan": async (ctx) => {
    const scratch = createColdScratch(
      ctx.repoRoot,
      ctx.realAppDataDir,
      // Inside the batch scratch root so batch teardown removes it too.
      path.join(ctx.runId, "library-scan"),
    );
    const manifest = computeDataManifest({
      appDataDir: path.join(scratch.scratchRoot, scratch.appDataDirName),
      musicFolders: ctx.musicFolders,
      cacheProfile: "cold",
      sessionValid: false, // stamped true by runLaunchCycle after readiness
    });
    const result = await runLaunchCycle({
      repoRoot: ctx.repoRoot,
      scratchRoot: scratch.scratchRoot,
      headless: ctx.headless,
      manifest,
      steps: async (page) => {
        await openLibraryView(page);
        await waitForLibraryRows(page);
      },
    });
    return toResult("library.scan", ctx, result, manifest);
  },

  // §4.2 — hydrate-from-cache vs network delta sync (cache.json present on
  // the warm batch copy after the startup runs). The sync settles during the
  // readiness gate; the steps confirm the app is past the sync (no "Syncing"
  // indicator) before close so the ytmusicSyncLibrary record lands in the trace.
  "library.sync.yt": async (ctx) => {
    const manifest = computeDataManifest({
      appDataDir: ctx.appDataDir,
      musicFolders: ctx.musicFolders,
      cacheProfile: "warm",
      sessionValid: false,
    });
    const result = await runLaunchCycle({
      repoRoot: ctx.repoRoot,
      scratchRoot: ctx.scratchRoot,
      headless: ctx.headless,
      manifest,
      steps: async (page) => {
        await openLibraryView(page);
        // If a background sync is still running, wait it out — the step would
        // be a driver bug if it closed the app mid-sync.
        await page.waitForFunction(
          () => !(document.body?.innerText ?? "").includes("Syncing"),
          undefined,
          { timeout: 180_000 },
        );
      },
    });
    return toResult("library.sync.yt", ctx, result, manifest);
  },

  // §4.3 — renderer input→results over the real local library (no IPC). The
  // query is a real-title fragment read from the rendered library list (§5);
  // the source is forced to "local" through the real UI so the scenario never
  // accidentally hits the remote search path (the scratch profile is isolated
  // per §3.2, but the driver stays deterministic regardless).
  "search.local": async (ctx) => {
    const manifest = computeDataManifest({
      appDataDir: ctx.appDataDir,
      musicFolders: ctx.musicFolders,
      cacheProfile: "warm",
      sessionValid: false,
    });
    const result = await runLaunchCycle({
      repoRoot: ctx.repoRoot,
      scratchRoot: ctx.scratchRoot,
      headless: ctx.headless,
      manifest,
      steps: async (page) => {
        await switchLibrarySource(page, "local");
        await openLibraryView(page);
        const fragment = await readRealTitleFragment(page);
        await openSearchView(page);
        await typeSearch(page, fragment);
      },
    });
    return toResult("search.local", ctx, result, manifest);
  },

  // §4.3 — fixed query through the network; API + UX latency. The catalog's
  // "<fixed query string>" placeholder is resolved from the real library
  // (design §5: real data only — a hardcoded query would be synthetic); the
  // source must be YT Music for the remote search path.
  "search.remote": async (ctx) => {
    const manifest = computeDataManifest({
      appDataDir: ctx.appDataDir,
      musicFolders: ctx.musicFolders,
      cacheProfile: "warm",
      sessionValid: false,
    });
    const result = await runLaunchCycle({
      repoRoot: ctx.repoRoot,
      scratchRoot: ctx.scratchRoot,
      headless: ctx.headless,
      manifest,
      steps: async (page) => {
        await openLibraryView(page);
        const fragment = await readRealTitleFragment(page);
        await switchLibrarySource(page, "ytmusic");
        await openSearchView(page);
        await typeSearch(page, fragment);
      },
    });
    return toResult("search.remote", ctx, result, manifest);
  },
};

function toResult(
  scenarioId: string,
  ctx: RunnerContext,
  result: Awaited<ReturnType<typeof runLaunchCycle>>,
  manifest: BenchDataManifest,
): ScenarioRunResult {
  return {
    scenarioId,
    runId: ctx.runId,
    tracePath: result.tracePath,
    trace: result.trace,
    manifest: result.trace.meta.dataManifest ?? manifest,
  };
}

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
  return toResult(`startup.${cacheProfile}`, ctx, result, manifest);
}

export async function runScenarios(
  options: ScenarioRunOptions = {},
): Promise<ScenarioRunResult[]> {
  const headless =
    options.headless ?? process.env["MUXICS_BENCH_HEADLESS"] === "1";
  const scenarioIds = options.scenarios ?? [...IMPLEMENTED_SCENARIO_IDS];
  for (const id of scenarioIds) {
    getScenario(id); // validate ids up front — a typo fails before any launch
    if (!EXECUTORS[id]) {
      throw new Error(
        `Scenario "${id}" has no executor yet — wired so far: ${IMPLEMENTED_SCENARIO_IDS.join(", ")} (startup #41, library + search #42; playlists/playback/rendering land in #43–#44).`,
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
      realAppDataDir: chain.report.appDataDir,
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
