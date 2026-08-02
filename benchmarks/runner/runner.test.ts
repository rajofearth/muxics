import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getScenario,
  SCENARIO_CATALOG,
  STARTUP_SCENARIO_IDS,
} from "../scenarios/catalog";
import { runScenarios } from "./runner";

// Scenario runner (issue #41): executes the startup pair end to end through
// real UI interactions + the readiness gate — startup.cold on a fresh scratch
// copy with app-level caches emptied, then startup.warm relaunching the SAME
// copy. Both are session-validated (a local-only run never yields a trace) and
// each trace carries the data manifest in its meta (design §5, Q4).
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
    "runs startup.cold then startup.warm against one scratch copy, traces carry the data manifest",
    async () => {
      const headless = process.env["MUXICS_BENCH_HEADLESS"] === "1";
      const results = await runScenarios({ headless });

      expect(results.map((r) => r.scenarioId)).toEqual([...STARTUP_SCENARIO_IDS]);
      // One batch: cold and warm share the same scratch copy (§4.1).
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
        expect(r.manifest.playlistCount).toBeGreaterThanOrEqual(0);
        // Startup instrumentation ran — initSession stage marks + stage
        // measures present (§4.1). When the session is briefly "recovering"
        // (self-heal, §3.1) initSession returns early and the final
        // `first stage → ready` measure is absent — the driver's readiness
        // gate is the session-validity authority, not this measure. But a
        // run that DID complete initSession must carry the paired measure.
        expect(
          r.trace.marks.some((m) => m.name.startsWith("initSession:")),
          `${r.scenarioId} initSession marks`,
        ).toBe(true);
        expect(
          r.trace.measures.length,
          `${r.scenarioId} stage measures`,
        ).toBeGreaterThan(0);
        if (r.trace.marks.some((m) => m.name === "initSession:done")) {
          expect(
            r.trace.measures.some((m) => m.name === "initSession:first stage → ready"),
            `${r.scenarioId} startup measure`,
          ).toBe(true);
        }
        expect(fs.existsSync(r.tracePath)).toBe(true);
      }

      const [cold, warm] = results;
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

      console.log(
        `[bench:runner] cold=${cold.tracePath} warm=${warm.tracePath} ` +
          `warmCacheBytes=${warmBytes} warmPlaylists=${warm.manifest.playlistCount}`,
      );
    },
    900_000,
  );
});
