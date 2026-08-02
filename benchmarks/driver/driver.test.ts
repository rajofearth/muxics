import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { runDriverCycle } from "./driver";

// Bench driver (issue #40): launch the dev app end-to-end against a read-only
// copy of the real session, pass the readiness gate, and collect one v1 trace.
// Visible by default; MUXICS_BENCH_HEADLESS=1 hides the window — identical
// flows, assertions, and trace either way (design §3.6).
describe("muxics bench driver", () => {
  it(
    "launches the dev app, passes pre-flight + readiness, and collects a valid trace",
    async () => {
      const headless = process.env["MUXICS_BENCH_HEADLESS"] === "1";
      const result = await runDriverCycle({ headless });

      expect(result.trace.schemaVersion).toBe(1);
      expect(result.trace.meta.appName).toBe("muxics");
      expect(result.trace.generatedAt).toBeTruthy();
      expect(result.trace.reason).toMatch(/renderer flush|app quit/);
      expect(result.trace.ipc.length).toBeGreaterThan(0);
      expect(result.trace.marks.length).toBeGreaterThan(0);
      // Data manifest attached (design §5 Q4) — cold profile, session-valid.
      expect(result.trace.meta.dataManifest?.cacheProfile).toBe("cold");
      expect(result.trace.meta.dataManifest?.sessionValid).toBe(true);
      expect(result.trace.meta.dataManifest?.musicFolders.length).toBeGreaterThan(0);
      expect(fs.existsSync(result.tracePath)).toBe(true);

      console.log(
        `[bench:driver] run ${result.runId} (${result.headless ? "headless" : "visible"}): ${result.tracePath}`,
      );
    },
    600_000,
  );
});
