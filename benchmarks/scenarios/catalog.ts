// Shared scenario catalog (issues #41–#44) — every locked flow from
// docs/benchmarks/design.md §4, as data: id, area, inputs, measures.
//
// The design is LOCKED (#34); this module is the single source the runner and
// the later compare/registry tooling (#45–#47) read from. The runner (#41)
// executes the startup pair end to end; #42 adds the library + search flows;
// #43–#44 add the rest — until then the remaining flows are catalog data only.
//
// Measure names are the app-side marks/measures/IPC channels that exist in the
// instrumentation layer (#39) — see the design §4 tables and the grep-verified
// mark set in src/mainview/ (bench.ts, sessionInit.ts, SearchView, TrackTable,
// NowPlayingView, useAudioEngine). Names marked "(new)" in §4 do not exist yet
// and are listed here only when their ticket lands.

export type ScenarioArea =
  | "startup/splash"
  | "library"
  | "search"
  | "playlists"
  | "playback"
  | "rendering"
  | "IPC";

/**
 * Locked inputs (design §4 tables). Only the startup pair is executor-wired
 * in #41; the rest are the contract #42–#44 build against.
 */
export interface ScenarioInputs {
  /** Scratch profile variant (design §5) — the cold/warm axis. */
  profile?: "cold" | "warm" | "warm-cache";
  /** Fresh scratch copy of the real app-data dir (§3.2). */
  freshScratchCopy?: boolean;
  /** Same scratch copy relaunched immediately after the preceding run. */
  relaunchSameCopy?: boolean;
  /** Real YouTube session required (design §4 run group). */
  realSession?: boolean;
  /** Real local music folders: default music path + watch folders (§5). */
  realMusicFolders?: boolean;
  /** Fixed remote query string (search.remote). */
  query?: string;
  /** Fixed remote playlist id (playlist.open.yt). */
  playlistId?: string;
  /** Track whose stream + audio bytes are fully cached (playback.cached). */
  fullyCachedTrack?: boolean;
  /** Real local file from the library (playback.local). */
  localTrack?: boolean;
  /** Track NOT cached — forces a yt-dlp stream fetch (playback.stream.ytdlp-miss). */
  uncachedTrack?: boolean;
  /** Queue of ≥3 tracks for auto-advance (playback.advance). */
  queueSize?: number;
  /** Scroll the virtualized library list (render.library-list). */
  scrollList?: boolean;
}

/** What a scenario measures (design §4 "Measures" column), decomposed. */
export interface ScenarioMeasures {
  /** Trace mark names the scenario must produce. */
  marks: string[];
  /** Trace measure names (paired forwarded marks, design §2.3.3). */
  measures: string[];
  /** IPC channels timed implicitly by the preload wrap (design §4.7). */
  ipc: string[];
  /** Driver steps — real UI interactions + readiness assertions (§3.4). */
  driverSteps: string[];
}

export interface ScenarioDefinition {
  /** Locked scenario id, e.g. "startup.cold" (design §4). */
  id: string;
  /** Catalog area (design §4.x). */
  area: ScenarioArea;
  /** Run group (design §4) — v1 is real-session only. */
  group: "real-session";
  /** Seeded status (design §7.3) — baseline expectations. */
  seeded: "yes" | "no" | "partial";
  inputs: ScenarioInputs;
  measures: ScenarioMeasures;
}

// Startup IPCs locked in §4.1 — timed implicitly by the preload wrap.
const STARTUP_IPCS = [
  "authGetStatus",
  "getWatchFolders",
  "getSettings",
  "scanFolders",
  "listPlaylists",
  "ytmusicLoadCachedLibrary",
  "ytmusicSyncLibrary",
  "ytmusicGetHomeFeed",
];

const STARTUP_DRIVER_STEPS = [
  "launch → ready-to-show",
  "launch → initReady (splash dismissed)",
  "assert authGetStatus loggedIn (session-validated readiness)",
  "drive to homepage, verify real home-feed sections render",
];

export const SCENARIO_CATALOG: ScenarioDefinition[] = [
  {
    // §4.1 — cold: fresh copy, app-level caches emptied, first launch of batch.
    id: "startup.cold",
    area: "startup/splash",
    group: "real-session",
    seeded: "yes",
    inputs: {
      profile: "cold",
      freshScratchCopy: true,
      relaunchSameCopy: false,
      realSession: true,
      realMusicFolders: true,
    },
    measures: {
      marks: [
        "initSession:Checking authentication...",
        "initSession:Scanning local library...",
        "initSession:Loading playlists...",
        "initSession:Loading YouTube Music...",
        "initSession:Syncing YouTube Music...",
        "initSession:Almost ready...",
        "initSession:done",
      ],
      measures: [
        "initSession:first stage → ready",
        "initSession:<stage> → <stage> (per-stage breakdown)",
      ],
      ipc: [...STARTUP_IPCS],
      driverSteps: [...STARTUP_DRIVER_STEPS],
    },
  },
  {
    // §4.1 — warm: same scratch copy relaunched; app disk caches present →
    // hydrate-from-cache + delta-sync paths.
    id: "startup.warm",
    area: "startup/splash",
    group: "real-session",
    seeded: "yes",
    inputs: {
      profile: "warm",
      freshScratchCopy: false,
      relaunchSameCopy: true,
      realSession: true,
      realMusicFolders: true,
    },
    measures: {
      marks: [
        "initSession:Checking authentication...",
        "initSession:Scanning local library...",
        "initSession:Loading playlists...",
        "initSession:Loading YouTube Music...",
        "initSession:Syncing YouTube Music...",
        "initSession:Almost ready...",
        "initSession:done",
      ],
      measures: [
        "initSession:first stage → ready",
        "initSession:<stage> → <stage> (per-stage breakdown)",
      ],
      ipc: [...STARTUP_IPCS],
      driverSteps: [...STARTUP_DRIVER_STEPS],
    },
  },
  {
    // §4.2 — whole-scan latency + metadata throughput on real folders.
    id: "library.scan",
    area: "library",
    group: "real-session",
    seeded: "yes",
    inputs: {
      realSession: true,
      realMusicFolders: true,
      freshScratchCopy: true,
    },
    measures: {
      marks: [],
      measures: ["initSession:Scanning local library → Loading playlists"],
      ipc: ["scanFolders", "getTrackMetadata"],
      driverSteps: ["open library view", "wait for virtualized list render"],
    },
  },
  {
    // §4.2 — hydrate-from-cache vs network delta sync (cache.json pre-populated).
    id: "library.sync.yt",
    area: "library",
    group: "real-session",
    seeded: "yes",
    inputs: { realSession: true, profile: "warm", relaunchSameCopy: true },
    measures: {
      marks: [],
      measures: ["initSession:Loading YouTube Music → Almost ready"],
      ipc: ["ytmusicLoadCachedLibrary", "ytmusicSyncLibrary"],
      driverSteps: ["wait for readiness with cache.json present"],
    },
  },
  {
    // §4.3 — renderer input → results (no IPC; local filter).
    id: "search.local",
    area: "search",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true, realMusicFolders: true },
    measures: {
      marks: ["search:input", "search:results"],
      measures: [],
      ipc: [],
      driverSteps: [
        "focus search box",
        "type a real-title fragment",
        "wait for filtered results",
      ],
    },
  },
  {
    // §4.3 — fixed query through the network; API + UX latency.
    id: "search.remote",
    area: "search",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true, query: "<fixed query string>" },
    measures: {
      marks: ["search:results"],
      measures: [],
      ipc: ["ytmusicSearch"],
      driverSteps: ["type query", "wait for remote results"],
    },
  },
  {
    // §4.4 — open a real local playlist file from the copied profile.
    id: "playlist.open.local",
    area: "playlists",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true, realMusicFolders: true },
    measures: {
      // renderer list-render mark is "(new)" in §4 — lands with its ticket
      marks: [],
      measures: [],
      ipc: ["listPlaylists", "loadPlaylist"],
      driverSteps: ["open a local playlist", "wait for render"],
    },
  },
  {
    // §4.4 — fixed remote playlistId with cached session.
    id: "playlist.open.yt",
    area: "playlists",
    group: "real-session",
    seeded: "yes",
    inputs: { realSession: true, playlistId: "<fixed playlistId>" },
    measures: {
      marks: [], // hydration marks
      measures: [],
      ipc: ["ytmusicGetPlaylist"],
      driverSteps: ["open YouTube playlist", "wait for items"],
    },
  },
  {
    // §4.5 — track fully cached in the scratch copy (audio\ + media-index.json).
    id: "playback.cached",
    area: "playback",
    group: "real-session",
    seeded: "yes",
    inputs: { realSession: true, profile: "warm-cache", fullyCachedTrack: true },
    measures: {
      marks: [
        "useAudioEngine:loadAndPlay:start",
        "useAudioEngine:loadAndPlay:playing",
      ],
      measures: ["useAudioEngine:loadAndPlay:start → playing"],
      ipc: ["ytmusicGetPlayback"],
      driverSteps: ["click a cached track", "wait for playing state"],
    },
  },
  {
    // §4.5 — real local file via getPlaybackUrl + loadAndPlay.
    id: "playback.local",
    area: "playback",
    group: "real-session",
    seeded: "partial",
    inputs: { realSession: true, realMusicFolders: true, localTrack: true },
    measures: {
      marks: [
        "useAudioEngine:loadAndPlay:start",
        "useAudioEngine:loadAndPlay:playing",
      ],
      measures: ["useAudioEngine:loadAndPlay:start → playing"],
      ipc: ["getPlaybackUrl"],
      driverSteps: ["click a local track", "wait for first timeupdate"],
    },
  },
  {
    // §4.5 — uncached track forces a yt-dlp stream fetch (network).
    id: "playback.stream.ytdlp-miss",
    area: "playback",
    group: "real-session",
    seeded: "yes",
    inputs: { realSession: true, uncachedTrack: true },
    measures: {
      marks: [
        "useAudioEngine:loadAndPlay:start",
        "useAudioEngine:loadAndPlay:playing",
      ],
      measures: ["useAudioEngine:loadAndPlay:start → playing"],
      ipc: ["ytmusicGetPlayback"],
      driverSteps: ["click an uncached track", "wait for playing state"],
    },
  },
  {
    // §4.5 — next track prefetched by the stream preloader after prior playback.
    id: "playback.preloader-hit",
    area: "playback",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true },
    measures: {
      marks: [
        "useAudioEngine:loadAndPlay:start",
        "useAudioEngine:loadAndPlay:playing",
      ],
      measures: ["useAudioEngine:loadAndPlay:start → playing"],
      // prefetch IPC timing — named when the executor lands (#43)
      ipc: [],
      driverSteps: ["play a track", "advance to the prefetched next track"],
    },
  },
  {
    // §4.5 — auto-advance across a queue of ≥3 tracks.
    id: "playback.advance",
    area: "playback",
    group: "real-session",
    seeded: "partial",
    inputs: { realSession: true, queueSize: 3 },
    measures: {
      marks: [
        "useAudioEngine:loadAndPlay:start",
        "useAudioEngine:loadAndPlay:playing",
      ],
      measures: ["useAudioEngine:loadAndPlay:start → playing (consecutive)"],
      ipc: [],
      driverSteps: ["queue ≥3 tracks", "let auto-advance play through"],
    },
  },
  {
    // §4.6 — post-frame mark after each splash stage render.
    id: "render.splash",
    area: "rendering",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true, freshScratchCopy: true },
    measures: {
      marks: ["render:splash:<status>:frame"],
      measures: [],
      ipc: [],
      driverSteps: ["startup run"],
    },
  },
  {
    // §4.6 — virtualized library list: first paint + scroll frames.
    id: "render.library-list",
    area: "rendering",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true, realMusicFolders: true, scrollList: true },
    measures: {
      marks: [
        "render:library-list:firstPaint",
        "render:library-list:scrollFrame",
      ],
      measures: [],
      ipc: [],
      driverSteps: ["open library", "scroll the virtualized list"],
    },
  },
  {
    // §4.6 — now-playing view mount while playing a track.
    id: "render.now-playing",
    area: "rendering",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true },
    measures: {
      marks: ["render:now-playing:mount"],
      measures: [],
      ipc: [],
      driverSteps: ["play a track", "wait for now-playing view mount"],
    },
  },
  {
    // §4.7 — diagnostic, not a pass/fail flow: counts + per-call p95 for the
    // noise-filtered burst names during library load.
    id: "ipc.burst",
    area: "IPC",
    group: "real-session",
    seeded: "no",
    inputs: { realSession: true, realMusicFolders: true },
    measures: {
      marks: [],
      measures: [],
      ipc: ["getTrackMetadata", "getFullyCachedTrackIds"],
      driverSteps: ["library load (diagnostic, no pass/fail)"],
    },
  },
];

/** The startup pair — the flows with executors in #41 (§4.1). */
export const STARTUP_SCENARIO_IDS = ["startup.cold", "startup.warm"] as const;

/**
 * Scenarios with executors wired so far — the runner's default set: the
 * startup pair (#41) plus the library + search flows (#42, §4.2–4.3).
 */
export const IMPLEMENTED_SCENARIO_IDS = [
  ...STARTUP_SCENARIO_IDS,
  "library.scan",
  "library.sync.yt",
  "search.local",
  "search.remote",
] as const;

export function getScenario(id: string): ScenarioDefinition {
  const def = SCENARIO_CATALOG.find((s) => s.id === id);
  if (!def) {
    throw new Error(`Unknown scenario id "${id}" (see SCENARIO_CATALOG).`);
  }
  return def;
}
