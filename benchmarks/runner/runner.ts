// Scenario runner (issues #41–#44) — executes catalog scenarios end to end
// through the driver: real UI interactions + the session-validated
// readiness gate (design §3.1, §3.4). Wired so far:
//
//   startup.cold            — fresh scratch copy, app-level caches emptied (§5 cold).
//   startup.warm            — the SAME scratch copy relaunched; caches present (§5 warm).
//   library.scan            — whole-scan latency + metadata throughput (§4.2); fresh
//                             cold copy (catalog input freshScratchCopy) so the scan
//                             and the getTrackMetadata burst run with empty caches.
//   library.sync.yt         — hydrate vs sync split with the real session (§4.2); runs
//                             on the warm batch copy (cache.json from the prior runs).
//   search.local            — renderer input→results over the real local library (§4.3).
//   search.remote           — ytmusicSearch IPC + results mark, source switched to
//                             YT Music through the real title-bar dropdown (§4.3).
//   playlist.open.local     — real local playlist opened via the grid, source forced
//                             to Local (§4.4); render:playlist:list mark.
//   playlist.open.yt        — real YT playlist opened via the grid on the warm
//                             batch copy; hydration marks + ytmusicGetPlaylist
//                             IPC when the cache state triggers a fetch (§4.4).
//   playback.cached/…       — §4.5 playback matrix runs on the warm batch copy;
//                             cache-dependent flows are BEST-EFFORT (the §4.5
//                             cache-layer caveat) — marks/IPCs asserted, never
//                             cache state.
//   playback.preloader-hit  — prefetch marks/measure + Next-click advance (§4.5).
//   render.splash           — post-frame mark per splash stage (§4.6); fresh cold
//                             copy, no steps (readiness gate waits out the splash).
//   render.library-list     — list first-paint + scroll-frame marks (§4.6); scrolls
//                             the virtualized TrackTable through the real DOM.
//   render.now-playing      — now-playing view mount mark (§4.6); plays a track,
//                             then navigates via the app-navigate funnel.
//   ipc.burst               — §4.7 DIAGNOSTIC: counts + per-call p50/p95 for the
//                             getTrackMetadata / getFullyCachedTrackIds burst during
//                             library load; never pass/fail.
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
  clickPlayableTrack,
  clickTrackRow,
  driveQueueAdvance,
  openLibraryView,
  openLocalPlaylist,
  openSearchView,
  openYtPlaylist,
  playTrackThenPrefetchAdvance,
  readRealTitleFragment,
  scrollLibraryList,
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

// Executors wired: the startup pair (#41), the library + search flows (#42),
// the playlist + playback flows (#43), and the rendering + ipc.burst flows
// (#44). Each builds the data manifest for its cache profile before launch
// (sizes = the state the run starts from), then launches through the driver,
// which stamps manifest.sessionValid after the readiness gate passes and
// attaches the manifest to the trace (§5 Q4).
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

  // §4.4 — open a real LOCAL playlist through the UI: the source is forced to
  // Local so the grid lists only local playlist files from the copied profile;
  // the steps click the first one and wait for its track list (render mark).
  // The catalog's fixed playlistId stays the documented contract; per design
  // §5 the driver opens a real playlist rather than a hardcoded id.
  "playlist.open.local": async (ctx) => {
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
        await openLocalPlaylist(page);
      },
    });
    return toResult("playlist.open.local", ctx, result, manifest);
  },

  // §4.4 — open a real YT Music playlist through the UI (source YT Music so
  // the grid lists the remote playlists from the copied session). The
  // hydration fetch (ytmusicGetPlaylist + hydration marks — design §4.4's
  // "hydration delta") is CACHE-STATE dependent: it fires only when the
  // copied profile's playlists load thin from the (known-buggy) cache layer;
  // already-rich playlists open as a cache hit with no fetch. Best-effort per
  // the §4.5 caveat — the trace records whichever path the app actually takes.
  "playlist.open.yt": async (ctx) => {
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
        await openYtPlaylist(page);
      },
    });
    return toResult("playlist.open.yt", ctx, result, manifest);
  },

  // §4.5 — cache-dependent flows (cached, preloader-hit) are BEST-EFFORT: the
  // batch copy's on-disk cache is whatever the earlier runs left behind (the
  // cache-layer caveat is a known, flagged defect — design §4.5). The steps
  // assert mark/IPC presence, never cache state. All playback executors run on
  // the shared warm batch copy like library.sync.yt.
  "playback.cached": async (ctx) => {
    const manifest = computeDataManifest({
      appDataDir: ctx.appDataDir,
      musicFolders: ctx.musicFolders,
      // The catalog's warm-cache axis maps to the manifest's cold|warm pair.
      cacheProfile: "warm",
      sessionValid: false,
    });
    const result = await runLaunchCycle({
      repoRoot: ctx.repoRoot,
      scratchRoot: ctx.scratchRoot,
      headless: ctx.headless,
      manifest,
      steps: async (page) => {
        await switchLibrarySource(page, "ytmusic");
        await openLibraryView(page);
        await clickPlayableTrack(page);
      },
    });
    return toResult("playback.cached", ctx, result, manifest);
  },

  // §4.5 — real local file: source Local so every library row is a local file;
  // the click drives loadAndPlay via getPlaybackUrl(path). clickPlayableTrack
  // retries the next row if a corrupt file never reaches the first timeupdate
  // (which only fires after play() resolved — the measure has already landed).
  "playback.local": async (ctx) => {
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
        await clickPlayableTrack(page);
      },
    });
    return toResult("playback.local", ctx, result, manifest);
  },

  // §4.5 — uncached track forces the yt-dlp stream fetch (network). Whether the
  // clicked track is genuinely uncached is best-effort on the batch copy; the
  // ytmusicGetPlayback IPC + loadAndPlay measures are the asserted signals.
  "playback.stream.ytdlp-miss": async (ctx) => {
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
        await switchLibrarySource(page, "ytmusic");
        await openLibraryView(page);
        await clickPlayableTrack(page);
      },
    });
    return toResult("playback.stream.ytdlp-miss", ctx, result, manifest);
  },

  // §4.5 — prefetch effectiveness: play row 0 (the preloader immediately
  // prefetches the next tracks), then advance via the real Next button. The
  // streamPreloader prefetch marks/measure + the auto-timed ytmusicGetPlayback
  // IPC are the asserted signals; the cache hit itself is best-effort.
  "playback.preloader-hit": async (ctx) => {
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
        await switchLibrarySource(page, "ytmusic");
        await openLibraryView(page);
        await playTrackThenPrefetchAdvance(page);
      },
    });
    return toResult("playback.preloader-hit", ctx, result, manifest);
  },

  // §4.5 — auto-advance across a queue of ≥3 tracks: clicking row 0 makes the
  // whole view's list the queue; each track is sought near its end so the real
  // onEnded → playTrack(next) path fires, and every load re-emits the
  // loadAndPlay mark/measure pair (consecutive occurrences = the advance mix).
  "playback.advance": async (ctx) => {
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
        await switchLibrarySource(page, "ytmusic");
        await openLibraryView(page);
        await driveQueueAdvance(page, 3);
      },
    });
    return toResult("playback.advance", ctx, result, manifest);
  },

  // §4.6 — post-frame mark per splash stage. Fresh cold scratch copy (like
  // library.scan) so the splash renders the full stage sequence; NO steps —
  // the readiness gate already waits for splash dismissal, so every
  // render:splash:<status>:frame mark lands during initSession.
  "render.splash": async (ctx) => {
    const scratch = createColdScratch(
      ctx.repoRoot,
      ctx.realAppDataDir,
      // Inside the batch scratch root so batch teardown removes it too.
      path.join(ctx.runId, "render-splash"),
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
    });
    return toResult("render.splash", ctx, result, manifest);
  },

  // §4.6 — list first-paint + scroll-frame marks on the warm batch copy: open
  // the library, wait for the virtualized rows, then scroll the list through
  // the real DOM (fires the native scroll event the bench listener marks on).
  "render.library-list": async (ctx) => {
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
        await waitForLibraryRows(page);
        await scrollLibraryList(page);
      },
    });
    return toResult("render.library-list", ctx, result, manifest);
  },

  // §4.6 — now-playing view mount mark on the warm batch copy: play a track
  // (NowPlayingView renders only with a currentTrack), then navigate through
  // the same app-navigate funnel the driver's readiness gate uses (§3.1), and
  // wait for the view's Close button — its mount mark lands right after.
  "render.now-playing": async (ctx) => {
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
        await clickTrackRow(page, 0);
        await page.evaluate(() => {
          document.dispatchEvent(
            new CustomEvent("app-navigate", { detail: "now_playing" }),
          );
        });
        await page.waitForSelector('button[aria-label="Close Now Playing"]', {
          timeout: 30_000,
        });
        // The mount mark is post-frame (double rAF) — give it a beat to land
        // before close (same trailing-settle pattern as the playlist steps).
        await new Promise((resolve) => setTimeout(resolve, 400));
      },
    });
    return toResult("render.now-playing", ctx, result, manifest);
  },

  // §4.7 — DIAGNOSTIC: counts + per-call p50/p95 for the getTrackMetadata /
  // getFullyCachedTrackIds burst that fires during library load. The numbers
  // are logged, never asserted — ipc.burst is not a pass/fail flow.
  "ipc.burst": async (ctx) => {
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
        await waitForLibraryRows(page);
      },
    });
    const BURST_NAMES = [
      "desktop:request:getTrackMetadata",
      "desktop:request:getFullyCachedTrackIds",
    ];
    const durationsByIpc = new Map<string, number[]>();
    for (const rec of result.trace.ipc) {
      if (!BURST_NAMES.includes(rec.name)) continue;
      const durations = durationsByIpc.get(rec.name) ?? [];
      durations.push(rec.duration);
      durationsByIpc.set(rec.name, durations);
    }
    for (const [name, durations] of durationsByIpc) {
      durations.sort((a, b) => a - b);
      console.log(
        `[bench:runner] ipc.burst diagnostic: ${name} n=${durations.length} ` +
          `p50=${percentileSorted(durations, 50).toFixed(1)}ms ` +
          `p95=${percentileSorted(durations, 95).toFixed(1)}ms`,
      );
    }
    return toResult("ipc.burst", ctx, result, manifest);
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

/**
 * Nearest-rank percentile over a SORTED duration array (ms). Inline for the
 * ipc.burst diagnostic until #46 owns a stats module.
 */
function percentileSorted(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(
    sortedMs.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedMs.length) - 1),
  );
  return sortedMs[idx];
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
        `Scenario "${id}" has no executor yet — wired (issues #41–#44): ${IMPLEMENTED_SCENARIO_IDS.join(", ")}.`,
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
