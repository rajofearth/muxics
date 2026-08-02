// Benchmark contract — v1 trace schema + IPC channels for the MUXICS_BENCH=1
// instrumentation layer (issue #39). Shared by preload, main, and renderer.
// Locked shape: docs/benchmarks/design.md §2 and §6.2. With the flag off the
// app is byte-for-byte the same as before (zero behavior/overhead change).

export const BENCH_RECORD_CHANNEL_V1 = "desktop:bench:v1:record";
export const BENCH_FLUSH_CHANNEL_V1 = "desktop:bench:v1:flush";

export const BENCH_TRACE_SCHEMA_VERSION = 1 as const;

export interface BenchIpcRecord {
  kind: "ipc";
  /** Full channel name, e.g. "desktop:request:getSettings". */
  name: string;
  /**
   * Per-name sequence counter (1-based). Burst names (getTrackMetadata,
   * getFullyCachedTrackIds) dominate volume; seq keeps calls comparable
   * across runs so the registry/compare tooling can pair them (design §2.3.4).
   */
  seq: number;
  /** Epoch ms at invoke start (performance.timeOrigin + performance.now()). */
  start: number;
  duration: number;
}

export interface BenchMarkRecord {
  kind: "mark";
  name: string;
  /** Epoch ms (performance.timeOrigin + performance.now()). */
  time: number;
}

export interface BenchMeasureRecord {
  kind: "measure";
  name: string;
  /**
   * Epoch ms at measure start — the paired start mark's forwarded timestamp,
   * never a User Timing read-back (design §2.3.3).
   */
  start: number;
  duration: number;
}

export type BenchRecord = BenchIpcRecord | BenchMarkRecord | BenchMeasureRecord;

export interface BenchTraceMeta {
  appName: string;
  appVersion: string;
  platform: string;
  arch: string;
  versions: { electron: string; chrome: string; node: string };
  /** Host context for drift analysis (design §6.2) — filled by main from os. */
  host?: { cpu: string; ramGB: number };
}

export interface BenchTrace {
  schemaVersion: typeof BENCH_TRACE_SCHEMA_VERSION;
  reason: "renderer flush" | "app quit";
  generatedAt: string;
  meta: BenchTraceMeta;
  ipc: BenchIpcRecord[];
  marks: BenchMarkRecord[];
  measures: BenchMeasureRecord[];
}
