// Renderer-side benchmark helper (issue #39). Emits User Timing marks
// (muxics:-prefixed) and forwards records to main's trace collector through
// the batched v1 bridge. Every method is a no-op unless MUXICS_BENCH=1.
//
// Measures are computed from the forwarded mark timestamps (a renderer-side
// Map<name, time>), never read back from performance.measure entries — those
// names repeat across calls and getEntriesByName is unreliable (design §2.3.3).
import type { BenchRecord } from "../shared/bench-contract";
import { getDesktopBridge } from "./desktop";

const MARK_PREFIX = "muxics:";

function api() {
  return getDesktopBridge().bench;
}

function forward(record: BenchRecord) {
  api().record(record);
}

/** Latest forwarded timestamp per mark name — the pairing source for measures. */
const markTimes = new Map<string, number>();

function epochNow(): number {
  // Monotonic epoch ms — correlates with main-process stdout and driver-side
  // wall-clock (design §2.3.1).
  return performance.timeOrigin + performance.now();
}

export const bench = {
  get enabled(): boolean {
    return api().enabled;
  },

  mark(name: string): void {
    if (!api().enabled) return;
    performance.mark(MARK_PREFIX + name);
    const time = epochNow();
    markTimes.set(name, time);
    forward({ kind: "mark", name, time });
  },

  measure(name: string, startMark: string, endMark: string): void {
    if (!api().enabled) return;
    const start = markTimes.get(startMark);
    const end = markTimes.get(endMark);
    if (start === undefined || end === undefined) return;
    forward({ kind: "measure", name, start, duration: end - start });
  },
};

// Belt-and-suspenders: flush on page teardown; main also writes on
// will-quit, so the trace survives even if this never fires. The batch is
// shipped before the flush invoke, so main has every record when it writes.
if (typeof window !== "undefined" && bench.enabled) {
  window.addEventListener("pagehide", () => {
    void api().flush();
  });
}
