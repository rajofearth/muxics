import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getScenario,
  IMPLEMENTED_SCENARIO_IDS,
  SCENARIO_CATALOG,
} from "../scenarios/catalog";
import { runScenarios } from "./runner";

// Scenario runner (issues #41 + #42): executes the wired scenarios end to end
// through real UI interactions + the readiness gate — startup.cold on a fresh
// scratch copy with app-level caches emptied, startup.warm relaunching the
// SAME copy, then library.scan on its own fresh cold copy, library.sync.yt on
// the warm copy, and the two search flows. Every run is session-validated (a
// local-only run never yields a trace) and each trace carries the data
// manifest in its meta (design §5, Q4).
describe("muxics scenario runner", () => {
  it("catalog: every flow has an id, area, inputs, and measures", () => {
    expect(SCENARIO_CATALOG.length).toBeGreaterThanOrEqual(16);
    for (const def of SCENARIO_CATALOG) {
      expect(def.id, `scenario id missing`).toBeTruthy();
      expect(def.area, `${def.id} area`).toBeTruthy();
      expect(def.inputs, `${def.id} inputs`).toBeTruthy();
      expect(Array.isArray(def.measures.marks), `${def.id} marks`).toBe(true);
      expect(Array.isArray(def.measures.measures), `${def.id} measures`).toBe(true);
      expect(Array.isArray(def.measures.ipc), `${def.id} ipc`).toBe(true);
      expect(
        Array.isArray(def.measures.driverSteps),
        `${def.id} driverSteps`,
      ).toBe(true);
    }
    expect(getScenario("startup.cold").id).toBe("startup.cold");
    expect(() => getScenario("nope")).toThrow(/Unknown scenario id/);
  });

  it(
    "runs the wired scenarios end to end: startup pair, library scan/sync, and both searches",
    async () => {
      const headless = process.env["MUXICS_BENCH_HEADLESS"] === "1";
      const results = await runScenarios({ headless });

      expect(results.map((r) => r.scenarioId)).toEqual([...IMPLEMENTED_SCENARIO_IDS]);
      // One batch: every run shares the batch scratch root id (§4.1).
      expect(new Set(results.map((r) => r.runId)).size).toBe(1);

      for (const r of results) {
        // Session-validated readiness enforced — only logged-in runs yield a trace.
        expect(r.trace.meta.dataManifest?.sessionValid, `${r.scenarioId} sessionValid`).toBe(
          true,
        );
        expect(r.trace.schemaVersion).toBe(1);
        expect(r.trace.meta.appName).toBe("muxics");
        expect(r.trace.meta.dataManifest).toEqual(r.manifest);
        expect(r.manifest.musicFolders.length).toBeGreaterThan(0);
        // Every launch runs initSession — splash stage marks + stage measures.
        expect(
          r.trace.marks.some((m) => m.name.startsWith("initSession:")),
          `${r.scenarioId} initSession marks`,
        ).toBe(true);
        expect(
          r.trace.measures.length,
          `${r.scenarioId} stage measures`,
        ).toBeGreaterThan(0);
        expect(fs.existsSync(r.tracePath)).toBe(true);
      }

      const byId = (id: string) => results.find((r) => r.scenarioId === id)!;

      // ── Startup pair (unchanged #41 contract) ────────────────────────────
      const cold = byId("startup.cold");
      const warm = byId("startup.warm");
      expect(cold.manifest.cacheProfile).toBe("cold");
      expect(warm.manifest.cacheProfile).toBe("warm");

      // Cold launched with emptied caches — measured before launch, so every
      // cache entry is 0 (§5 `cold`).
      for (const c of cold.manifest.caches) {
        expect(c.files, `cold ${c.name} files`).toBe(0);
        expect(c.bytes, `cold ${c.name} bytes`).toBe(0);
      }

      // Warm relaunched the same copy after the cold run populated it — the
      // two differ exactly in app-level cache state (§4.1).
      const warmBytes = warm.manifest.caches.reduce((sum, c) => sum + c.bytes, 0);
      expect(warmBytes).toBeGreaterThan(0);

      // ── library.scan (§4.2) ─────────────────────────────────────────────
      const scan = byId("library.scan");
      expect(scan.manifest.cacheProfile).toBe("cold");
      // Whole-scan latency IPC (timed by the preload wrap).
      expect(
        scan.trace.ipc.some((i) => i.name === "desktop:request:scanFolders"),
        "library.scan scanFolders IPC",
      ).toBe(true);
      // Metadata throughput burst — a diagnostic name, never pass/fail.
      expect(
        scan.trace.ipc.some((i) => i.name === "desktop:request:getTrackMetadata"),
        "library.scan getTrackMetadata burst",
      ).toBe(true);
      // The scan stage measure + the library list rendered (steps opened it).
      expect(
        scan.trace.measures.some((m) => m.name.includes("Scanning local library")),
        "library.scan stage measure",
      ).toBe(true);
      expect(
        scan.trace.marks.some((m) => m.name === "render:library-list:firstPaint"),
        "library.scan list first paint",
      ).toBe(true);

      // ── library.sync.yt (§4.2) ──────────────────────────────────────────
      const sync = byId("library.sync.yt");
      expect(sync.manifest.cacheProfile).toBe("warm");
      expect(
        sync.trace.ipc.some((i) => i.name === "desktop:request:ytmusicLoadCachedLibrary"),
        "library.sync.yt hydrate IPC",
      ).toBe(true);
      expect(
        sync.trace.ipc.some((i) => i.name === "desktop:request:ytmusicSyncLibrary"),
        "library.sync.yt sync IPC",
      ).toBe(true);

      // ── search.local (§4.3) ─────────────────────────────────────────────
      const searchLocal = byId("search.local");
      expect(
        searchLocal.trace.marks.some((m) => m.name === "search:input"),
        "search.local input mark",
      ).toBe(true);
      expect(
        searchLocal.trace.marks.some((m) => m.name === "search:results"),
        "search.local results mark",
      ).toBe(true);
      // The local filter is renderer-only — the remote search path must never
      // fire in this scenario (design §4.3: "no IPC").
      expect(
        searchLocal.trace.ipc.some(
          (i) => i.name === "desktop:request:ytmusicSearch",
        ),
        "search.local must not hit the remote search path",
      ).toBe(false);

      // ── search.remote (§4.3) ────────────────────────────────────────────
      const searchRemote = byId("search.remote");
      expect(
        searchRemote.trace.marks.some((m) => m.name === "search:input"),
        "search.remote input mark",
      ).toBe(true);
      expect(
        searchRemote.trace.marks.some((m) => m.name === "search:results"),
        "search.remote results mark",
      ).toBe(true);
      expect(
        searchRemote.trace.ipc.some((i) => i.name === "desktop:request:ytmusicSearch"),
        "search.remote ytmusicSearch IPC",
      ).toBe(true);

      console.log(
        `[bench:runner] cold=${cold.tracePath} warm=${warm.tracePath} ` +
          `scan=${scan.tracePath} sync=${sync.tracePath} ` +
          `searchLocal=${searchLocal.tracePath} searchRemote=${searchRemote.tracePath} ` +
          `warmCacheBytes=${warmBytes} warmPlaylists=${warm.manifest.playlistCount}`,
      );
    },
    1_800_000, // six real launches + builds — budget generously
  );
});
