// PROTOTYPE — benchmark instrumentation stub (#37), throwaway.
// Shared types + IPC channel names for the MUXICS_BENCH=1 trace capture.
// This is a scratch seam to answer "can a minimal stub capture a real
// benchmark trace" — not part of the real benchmark system.

export const BENCH_RECORD_CHANNEL = "desktop:bench:record";
export const BENCH_FLUSH_CHANNEL = "desktop:bench:flush";

export interface BenchIpcRecord {
  kind: "ipc";
  /** Full channel name, e.g. "desktop:request:getSettings". */
  name: string;
  /** performance.now() at invoke start (renderer time origin). */
  start: number;
  duration: number;
}

export interface BenchMarkRecord {
  kind: "mark";
  name: string;
  /** performance.now() at mark time (renderer time origin). */
  time: number;
}

export interface BenchMeasureRecord {
  kind: "measure";
  name: string;
  /** performance.now() at measure start (renderer time origin). */
  start: number;
  duration: number;
}

export type BenchRecord = BenchIpcRecord | BenchMarkRecord | BenchMeasureRecord;

export interface BenchTrace {
  reason: string;
  generatedAt: string;
  meta: {
    appName: string;
    appVersion: string;
    platform: string;
    arch: string;
    versions: { electron: string; chrome: string; node: string };
  };
  ipc: BenchIpcRecord[];
  marks: BenchMarkRecord[];
  measures: BenchMeasureRecord[];
}
