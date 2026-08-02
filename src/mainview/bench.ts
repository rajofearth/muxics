// PROTOTYPE — benchmark instrumentation stub (#37), throwaway.
// Renderer-side helper: emits performance.mark/measure and forwards them to
// main's trace collector. Every method is a no-op unless MUXICS_BENCH=1.
import type { BenchRecord } from "../shared/bench";
import { getDesktopBridge } from "./desktop";

const MARK_PREFIX = "muxics:";

function api() {
  return getDesktopBridge().bench;
}

function forward(record: BenchRecord) {
  api().record(record);
}

export const bench = {
  get enabled(): boolean {
    return api().enabled;
  },

  mark(name: string): void {
    if (!api().enabled) return;
    performance.mark(MARK_PREFIX + name);
    forward({ kind: "mark", name, time: performance.now() });
  },

  measure(name: string, startMark: string, endMark: string): void {
    if (!api().enabled) return;
    performance.measure(
      MARK_PREFIX + name,
      MARK_PREFIX + startMark,
      MARK_PREFIX + endMark,
    );
    // Use the entry just created: measure names repeat across calls (e.g.
    // loadAndPlay), so take the LAST entry, not the first.
    const entry = performance
      .getEntriesByName(MARK_PREFIX + name, "measure")
      .at(-1);
    if (entry) {
      forward({
        kind: "measure",
        name,
        start: entry.startTime,
        duration: entry.duration,
      });
    }
  },
};

// PROTOTYPE — belt-and-suspenders: flush on page teardown; main also writes
// on will-quit, so the trace survives even if this never fires.
if (typeof window !== "undefined" && bench.enabled) {
  window.addEventListener("pagehide", () => {
    void api().flush();
  });
}
