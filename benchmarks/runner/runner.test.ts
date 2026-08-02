import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getScenario,
  IMPLEMENTED_SCENARIO_IDS,
  SCENARIO_CATALOG,
} from "../scenarios/catalog";
import { runScenarios } from "./runner";

// Scenario runner (issues #41–#44): executes the wired scenarios end to end
// through real UI interactions + the readiness gate — startup.cold on a fresh
// scratch copy with app-level caches emptied, startup.warm relaunching the
// SAME copy, then library.scan on its own fresh cold copy, library.sync.yt
// on the warm copy, the two search flows, the two playlist flows, the five
// playback flows, the three rendering flows, and the ipc.burst diagnostic.
// Every run is session-validated (a local-only run never yields a trace) and
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
    "runs the wired scenarios end to end: startup pair, library scan/sync, both searches, playlist open, the playback matrix, rendering, and the ipc.burst diagnostic",
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

      // ── playlist.open.local (§4.4) ───────────────────────────────────────
      const plLocal = byId("playlist.open.local");
      expect(
        plLocal.trace.marks.some((m) => m.name === "render:playlist:list"),
        "playlist.open.local list render mark",
      ).toBe(true);
      expect(
        plLocal.trace.ipc.some((i) => i.name === "desktop:request:listPlaylists"),
        "playlist.open.local listPlaylists IPC",
      ).toBe(true);
      // Real local playlist files are a §5.1 prerequisite for this scenario.
      expect(
        plLocal.manifest.playlistCount,
        "playlist.open.local real playlist files",
      ).toBeGreaterThan(0);

      // ── playlist.open.yt (§4.4) ───────────────────────────────────────
      const plYt = byId("playlist.open.yt");
      // The open-latency signals always land: the detail view rendered through
      // the real grid (same branch as the local playlist).
      expect(
        plYt.trace.marks.some((m) => m.name === "render:playlist:list"),
        "playlist.open.yt list render mark",
      ).toBe(true);
      // The hydration fetch (design §4.4's "hydration delta") is cache-state
      // dependent — the known-buggy cache layer decides whether the copied
      // profile's playlists load thin (fetch needed) or already-rich (cache
      // hit, no ytmusicGetPlaylist call). Best-effort per the §4.5 caveat:
      // assert the fetch only when it actually happened.
      const plYtHydrated = plYt.trace.marks.some(
        (m) => m.name === "playlist:yt:hydrate:start",
      );
      if (plYtHydrated) {
        expect(
          plYt.trace.marks.some((m) => m.name === "playlist:yt:hydrate:done"),
          "playlist.open.yt hydrate done",
        ).toBe(true);
        expect(
          plYt.trace.measures.some(
            (m) => m.name === "playlist:yt:hydrate:start → done",
          ),
          "playlist.open.yt hydrate measure",
        ).toBe(true);
        expect(
          plYt.trace.ipc.some(
            (i) => i.name === "desktop:request:ytmusicGetPlaylist",
          ),
          "playlist.open.yt ytmusicGetPlaylist IPC",
        ).toBe(true);
      }

      // ── playback.cached (§4.5) — best-effort: marks/IPCs, never cache ────
      const pCached = byId("playback.cached");
      expect(pCached.manifest.cacheProfile).toBe("warm");
      expect(
        pCached.trace.marks.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:start",
        ),
        "playback.cached load start mark",
      ).toBe(true);
      expect(
        pCached.trace.marks.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:playing",
        ),
        "playback.cached playing mark",
      ).toBe(true);
      expect(
        pCached.trace.measures.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:start → playing",
        ),
        "playback.cached load measure",
      ).toBe(true);
      expect(
        pCached.trace.ipc.some((i) => i.name === "desktop:request:ytmusicGetPlayback"),
        "playback.cached ytmusicGetPlayback IPC",
      ).toBe(true);

      // ── playback.local (§4.5) — getPlaybackUrl + loadAndPlay ─────────────
      const pLocal = byId("playback.local");
      expect(
        pLocal.trace.marks.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:start",
        ),
        "playback.local load start mark",
      ).toBe(true);
      expect(
        pLocal.trace.marks.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:playing",
        ),
        "playback.local playing mark",
      ).toBe(true);
      expect(
        pLocal.trace.measures.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:start → playing",
        ),
        "playback.local load measure",
      ).toBe(true);
      expect(
        pLocal.trace.ipc.some((i) => i.name === "desktop:request:getPlaybackUrl"),
        "playback.local getPlaybackUrl IPC",
      ).toBe(true);

      // ── playback.stream.ytdlp-miss (§4.5) ────────────────────────────────
      const pStream = byId("playback.stream.ytdlp-miss");
      expect(
        pStream.trace.marks.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:playing",
        ),
        "playback.stream.ytdlp-miss playing mark",
      ).toBe(true);
      expect(
        pStream.trace.measures.some(
          (m) => m.name === "useAudioEngine:loadAndPlay:start → playing",
        ),
        "playback.stream.ytdlp-miss load measure",
      ).toBe(true);
      expect(
        pStream.trace.ipc.some((i) => i.name === "desktop:request:ytmusicGetPlayback"),
        "playback.stream.ytdlp-miss ytmusicGetPlayback IPC",
      ).toBe(true);

      // ── playback.preloader-hit (§4.5) — prefetch marks + timed IPC ───────
      const pPrefetch = byId("playback.preloader-hit");
      expect(
        pPrefetch.trace.marks.some(
          (m) => m.name === "streamPreloader:prefetch:start",
        ),
        "playback.preloader-hit prefetch start",
      ).toBe(true);
      expect(
        pPrefetch.trace.marks.some(
          (m) => m.name === "streamPreloader:prefetch:done",
        ),
        "playback.preloader-hit prefetch done",
      ).toBe(true);
      expect(
        pPrefetch.trace.measures.some(
          (m) => m.name === "streamPreloader:prefetch:start → done",
        ),
        "playback.preloader-hit prefetch measure",
      ).toBe(true);
      expect(
        pPrefetch.trace.ipc.some(
          (i) => i.name === "desktop:request:ytmusicGetPlayback",
        ),
        "playback.preloader-hit ytmusicGetPlayback IPC",
      ).toBe(true);

      // ── playback.advance (§4.5) — ≥2 consecutive loadAndPlay measures ────
      const pAdvance = byId("playback.advance");
      const advanceMeasures = pAdvance.trace.measures.filter(
        (m) => m.name === "useAudioEngine:loadAndPlay:start → playing",
      ).length;
      expect(
        advanceMeasures,
        "playback.advance consecutive loadAndPlay measures",
      ).toBeGreaterThanOrEqual(2);

      // ── render.splash (§4.6) — post-frame mark per splash stage ─────────
      const rSplash = byId("render.splash");
      expect(rSplash.manifest.cacheProfile).toBe("cold");
      expect(
        rSplash.trace.marks.some(
          (m) =>
            m.name.startsWith("render:splash:") && m.name.endsWith(":frame"),
        ),
        "render.splash stage frame marks",
      ).toBe(true);

      // ── render.library-list (§4.6) — first paint + scroll frames ─────────
      const rList = byId("render.library-list");
      expect(
        rList.trace.marks.some(
          (m) => m.name === "render:library-list:firstPaint",
        ),
        "render.library-list first paint",
      ).toBe(true);
      expect(
        rList.trace.marks.filter(
          (m) => m.name === "render:library-list:scrollFrame",
        ).length,
        "render.library-list scroll frame marks",
      ).toBeGreaterThanOrEqual(1);

      // ── render.now-playing (§4.6) — view mount mark ──────────────────────
      const rNowPlaying = byId("render.now-playing");
      expect(
        rNowPlaying.trace.marks.some(
          (m) => m.name === "render:now-playing:mount",
        ),
        "render.now-playing mount mark",
      ).toBe(true);

      // ── ipc.burst (§4.7) — diagnostic: burst names present, never counts ─
      const burst = byId("ipc.burst");
      expect(
        burst.trace.ipc.some(
          (i) => i.name === "desktop:request:getTrackMetadata",
        ),
        "ipc.burst getTrackMetadata IPC",
      ).toBe(true);
      expect(
        burst.trace.ipc.some(
          (i) => i.name === "desktop:request:getFullyCachedTrackIds",
        ),
        "ipc.burst getFullyCachedTrackIds IPC",
      ).toBe(true);

      console.log(
        `[bench:runner] cold=${cold.tracePath} warm=${warm.tracePath} ` +
          `scan=${scan.tracePath} sync=${sync.tracePath} ` +
          `searchLocal=${searchLocal.tracePath} searchRemote=${searchRemote.tracePath} ` +
          `plLocal=${plLocal.tracePath} plYt=${plYt.tracePath} ` +
          `pCached=${pCached.tracePath} pLocal=${pLocal.tracePath} ` +
          `pStream=${pStream.tracePath} pPrefetch=${pPrefetch.tracePath} ` +
          `pAdvance=${pAdvance.tracePath} ` +
          `rSplash=${rSplash.tracePath} rList=${rList.tracePath} ` +
          `rNowPlaying=${rNowPlaying.tracePath} burst=${burst.tracePath} ` +
          `warmCacheBytes=${warmBytes} warmPlaylists=${warm.manifest.playlistCount}`,
      );
    },
    5_500_000, // 17 real launches + builds — budget generously
  );
});
