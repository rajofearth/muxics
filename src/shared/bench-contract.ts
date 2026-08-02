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

/**
 * Data manifest (design §5, grilling Q4) — what data a run actually used, so
 * runs stay comparable as the real library changes. Attached to the trace's
 * meta by the driver/runner after collection (the app does not know about the
 * bench data inventory); compare tooling prints it with results.
 */
export interface BenchDataManifest {
  /** Real music folders the run measured + audio file counts (§5.1.1). */
  musicFolders: Array<{ path: string; audioFiles: number }>;
  /** Playlist files (.m3u/.m3u8) in the copied profile's playlists/. */
  playlistCount: number;
  /**
   * True only when the readiness gate confirmed a logged-in session
   * (design §3.1) — a run that lands in local-only mode never yields a trace.
   */
  sessionValid: boolean;
  /** App-level cache state the run launched against (§4.1 cold/warm axis). */
  cacheProfile: "cold" | "warm";
  /** Per-cache sizes in the profile the run launched against. */
  caches: Array<{ name: string; files: number; bytes: number }>;
}

export interface BenchTraceMeta {
  appName: string;
  appVersion: string;
  platform: string;
  arch: string;
  versions: { electron: string; chrome: string; node: string };
  /** Host context for drift analysis (design §6.2) — filled by main from os. */
  host?: { cpu: string; ramGB: number };
  /** Data manifest (design §5 Q4) — driver-attached, see BenchDataManifest. */
  dataManifest?: BenchDataManifest;
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
