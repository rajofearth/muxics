# Muxics Benchmark System — Consolidated Design (LOCKED)

Destination artifact of [issue #34 "Design the Muxics benchmark system"](https://github.com/rajofearth/muxics/issues/34) (repo `rajofearth/muxics`).
Status: **LOCKED** — the design was grilled with the user (2026-08-02) and every decision is confirmed and marked `(LOCKED — ...)` inline. Implementation is mechanical hand-off work. See §11 for the locked-decision index.

Grounded in:

- Research deliverable: `docs/benchmarks/driver-research.md` (issue #36)
- Prototype deliverable: instrumentation stub in the working tree (`src/shared/bench.ts`, `src/mainview/bench.ts`, plus `MUXICS_BENCH=1`-gated changes in `src/electron/preload.ts`, `src/electron/main.ts`, `src/mainview/store/sessionInit.ts`, `src/mainview/hooks/useAudioEngine.ts`, `src/shared/desktop-contract.ts`, `src/mainview/desktop.ts`) (issue #37)
- Real traces: `benchmarks/runs/2026-08-01T19-12-24-540Z.json` (run A) and `benchmarks/runs/2026-08-01T19-14-58-972Z.json` (run B, the clean one)

Path references below are relative to the repo root (`P:\Projects\winamp-player`).

---

## 1. Destination & scope

### 1.1 What "benchmarking the Muxics UX" means

A local, repeatable measurement system that launches the **dev-session app**, drives real user flows (startup, library, search, playlists, playback, rendering, IPC), and produces **p50/p95 timing traces** from a single in-app instrumentation layer. It answers questions like "did startup regress?", "is remote search slower than last week?", "does the playback matrix hold its shape?" — on the user's own Windows dev machine, against the real YouTube Music session, without ever touching that session.

### 1.2 Locked decisions (from issue #34 map)

| Decision | Locked value |
| --- | --- |
| Integration | **Local-only. NO CI.** Playwright + vitest enter as local devDependencies only. |
| Build target | **Dev session only** — `VITE_DEV_SERVER_URL` electron launch. No production builds, no packaged-app benchmarking. |
| Taxonomy | **Seven areas**: startup/splash, library load & sync, search, playlists, playback, rendering, IPC overhead. Plus a generated flow registry manifest of every user flow and its timings. |
| Instrumentation shape | One shared in-app instrumentation layer, consumed by an automated Playwright driver **and** a dev-only recorder. |
| Results | Raw traces at `benchmarks/runs/<ts>.json`; checked-in `benchmarks/baseline.json` + `benchmarks/thresholds.json`. |
| Metrics | **p50/p95**; **relative % guards + absolute guards**. |
| Reporting | **Report-only by default** — comparisons print and flag, but do not fail the process unless asked. |
| Host | The user's Windows dev machine (currently `win32`/`arm64`, Electron 43.2.0 — from trace `meta`). |
| Threshold seeding | Seeded from **real prototype measurements**, never invented (this doc does that; see §7). |
| Reference pattern | synara repo's `benchmarks/acp-wire/*.json` + compare-script shape (**patterns only**, no code copied — `P:\Projects\synara\benchmarks\acp-wire\concurrent-request-comparison.json` shows the baseline/current/p50/p95/samples shape). |

### 1.3 Out of scope (locked, from the map)

- **CI integration** — benchmarks never run in `.github/workflows/build.yml`.
- **External services as targets** — YouTube CDN bandwidth, googlevideo throughput, YouTube API latency are not measured; our own resolution/playback timings (e.g. `ytmusicGetPlayback`) stay in.
- **A general app test suite** — the harness benchmarks; it does not test.
- **Auto-updater** (`electron-updater`) flows — dev mode disables them anyway (`main.ts:761-785`).
- **Browser-bridge / extension installation** — session *import* timing out; session *restore* timing in (real-session startup).
- **Production-build benchmarking** — dev session only.

---

## 2. Instrumentation layer

### 2.1 Prototype architecture (delivered by #37) — distilled

The prototype proves the seam works end to end with **zero app-behavior change**. Four pieces:

1. **Preload object-level wrap of `desktop:request:*`** (`src/electron/preload.ts`):
   - `BENCH_ENABLED = process.env["MUXICS_BENCH"] === "1"`.
   - `wrapTimedRequest()` wraps the **entire** request map in one pass — any current or future `desktop:request:*` method is timed automatically, no per-call-site edits (~40 methods in `src/shared/desktop-contract.ts:155-237`).
   - `timedRequest(name, invoke)` measures `start = performance.now()` → settle, on **both** resolve and reject; callers see the same promises/values/rejections.
   - **Zero cost when flag off**: when `MUXICS_BENCH` is unset, `timedRequest` returns `invoke()` untouched and the request object is **not wrapped at all**.
   - Exposes a `bench` bridge: `{ enabled, record, flush }` (`desktop-contract.ts:269-274`).
2. **Renderer helper** (`src/mainview/bench.ts`): `bench.mark(name)` and `bench.measure(name, startMark, endMark)`, every method a no-op unless enabled. Emits User Timing (`muxics:`-prefixed) **and** forwards records to main. Installed at the two UX seams:
   - **Splash stages** — `src/mainview/store/sessionInit.ts` `stage()` helper marks each `initSession:*` status stage and measures stage→stage plus `initSession:first stage → ready`.
   - **Playback** — `src/mainview/hooks/useAudioEngine.ts` marks `useAudioEngine:loadAndPlay:start` → `:playing` and measures the span.
3. **Main-process single aggregator + file writer** (`src/electron/main.ts`):
   - `benchRecords[]` accumulates records from `desktop:bench:record` (`ipcMain.on`), registered **only** when `MUXICS_BENCH=1`.
   - `writeBenchTrace(reason)` writes `benchmarks/runs/<iso-stamp>.json` (`app.getAppPath()`/benchmarks/runs — repo root in dev), emits `[muxics:bench] trace written …` to stdout for the driver.
   - **Single-write latch** (`benchWrittenCount`): a second flush with no new records is a no-op — one trace per app run even when both flush paths fire.
4. **Flush protocol**: renderer `pagehide` → `bench.flush()` ("renderer flush"); main `app.on("will-quit")` → "app quit". Both traces in the working tree are `reason: "renderer flush"` — the latch worked (no second "app quit" file).

Fallback for non-Electron dev (browser): `src/mainview/desktop.ts` supplies `bench: { enabled: false, record: () => {}, flush: () => Promise.resolve(null) }`.

### 2.2 Evidence from the real traces (why the production fixes matter)

- Run A: 367 ipc records — **322 (88%) are `getTrackMetadata` (210) + `getFullyCachedTrackIds` (112)**. Run B: 236/265 (89%). The two burst IPC names dominate volume and skew aggregates.
- Run A `measures[]` contains **10 identical `loadAndPlay` entries** (all `10966.1ms`) while the marks show 10 distinct start/playing pairs (from 160ms cache hits to 12.2s streams). The prototype's read-back-by-name (`getEntriesByName(...).at(-1)`) is unreliable — measure names repeat across calls.
- `start`/`time` values are renderer-relative `performance.now()` (marks start at ~1119ms, IPCs at ~3971ms) — not correlatable to wall-clock or main-process stdout events.
- Run B `getFullyCachedTrackIds` p50 = 2ms but max = 1522ms (n=26): one slow outlier that would trip a naive guard.

### 2.3 Production-layer fixes (LOCKED — grilling #38; each delta grounded in §2.2 — these are the deltas the implementation builds on top of the stub)

1. **Monotonic epoch start times** — record `start`/`time` as `performance.timeOrigin + performance.now()` (epoch ms). Correlates renderer records with main-process `[muxics:*]` stdout lines and driver-side timestamps. Evidence: renderer-relative times in both traces are meaningless outside the page.
2. **Atomic flush protocol** — write to `<stamp>.json.tmp` then rename to `<stamp>.json`; keep the single-write latch; keep `will-quit` + `pagehide` dual flush. A kill mid-write must never leave a corrupt file the compare tool chokes on.
3. **Don't read User Timing entries back by name** — compute measures from the **mark timestamps we already forward** (renderer keeps a `Map<name, time>`; `bench.measure` just pairs two timestamps). Drop `performance.measure` + `getEntriesByName` entirely, or give every measure a unique name. Evidence: the 10× duplicated measure artifact in run A.
4. **Noise filtering for high-count IPCs** — `getTrackMetadata` and `getFullyCachedTrackIds` are burst/metadata IPCs, not user-flow IPCs. Keep them in the raw trace (no data loss), but: (a) tag each record with a per-name sequence number so runs are comparable, (b) the registry/compare tooling excludes them from pass/fail by default and reports them as diagnostics (count + per-call p95). Evidence: 88–89% of records, 1522ms outlier.
5. **Single-write latch** — keep as-is (already in the stub, validated by the trace filenames).
6. **Batched record transport (LOCKED — grilling #38-Q6)**: renderer accumulates records and flushes to main every ~100ms plus an explicit final flush on `pagehide`/`flush()`. Measured durations are captured at wrap time, so batching never skews the numbers — it only changes when records *arrive* at main. (Fire-and-forget rejected — chatty at scale: 265 records ≈ 265 messages in the traces.)
7. **Channel naming (LOCKED — grilling #38-Q8)**: versioned channels `desktop:bench:v1:record` / `desktop:bench:v1:flush`; the trace gets `schemaVersion: 1`; types move from the prototype's throwaway `src/shared/bench.ts` into a proper contract module (`src/shared/bench-contract.ts`, beside `desktop-contract.ts`).

Instrumentation points beyond the prototype (needed to cover the seven areas) — **LOCKED (grilling #38-Q7)**, exact mark set:

| Mark pair | Where | Serves |
| --- | --- | --- |
| `nav:<view>:start` → `nav:<view>:end` | around `app-navigate` view transitions (`src/mainview/App.tsx:99-113`) | view-switch latency |
| `render:splash:<stage>:frame` | post-frame (double `requestAnimationFrame`) after each splash stage paint | per-stage paint latency |
| `render:library-list:firstPaint` | post-frame after the library list first renders | list first-paint |
| `render:library-list:scrollFrame` | one mark per frame during the scripted scroll | scroll frame time |
| `render:now-playing:mount` | post-frame after now-playing view mounts | view mount latency |
| `search:input` → `search:results` | SearchView: keystroke → results list update | search UX latency |
| `library:visible` | end of `loadLibrary` once the list is rendered | total library-load time |

All `muxics:`-prefixed (prototype convention); the names double as registry flow IDs (§8). Until these land, the `search.*`/`render.*`/library-total metrics are first-measurement with no seed (§7.3).

---

## 3. Driver mechanics (summary of `docs/benchmarks/driver-research.md`)

Full detail + primary-source citations live in the research doc (`docs/benchmarks/driver-research.md`); this section is the locked summary the driver implementation follows.

### 3.1 Launch chain (LOCKED — from research §1)

Do **not** reuse `pnpm dev` (concurrently process group; tsup watch unnecessary). Orchestrate:

1. `pnpm install` (once per checkout; pnpm 11, `package.json:7`).
2. `pnpm exec tsup --config tsup.electron.config.ts` — one-shot build of `dist-electron/main.cjs` + `preload.cjs` (gitignored; required because `"main": "dist-electron/main.cjs"`).
3. `pnpm exec vite --port 5173` as a child — binds `127.0.0.1:5173`, `strictPort` (fail fast if taken; `vite.config.ts:22-26`).
4. Playwright: `electron.launch({ args: ['.'], cwd: repoRoot, env: { VITE_DEV_SERVER_URL: 'http://localhost:5173', ...process.env } })` — Playwright resolves the Electron binary; setting env in the child avoids `cross-env`.
5. **Readiness gate** (extended, grilling Q3): audio server bound on `127.0.0.1:46021` (awaited **before** window creation, `main.ts:697`); first window `ready-to-show` (`main.ts:722-724`); splash dismissed (`initSession` done, `sessionInit.ts`); yt-dlp present in the scratch copy's `ytmusic\tools\` (§4 of research). **Session-validated readiness (LOCKED — user, grilling Q3)**: on every real-session run the driver must assert the app is actually **logged in** — `authGetStatus` → `loggedIn: true` and the home feed renders **real YouTube content** (not local-only / "Signed Out" mode). If the run lands in local-only mode it is **aborted and marked failed** (`reason: session-not-logged-in`); its trace is never treated as valid. The driver pre-flights the copied `session.json` (exists, unexpired-looking) before launch as a cheap early guard — the authoritative check is post-launch. Startup runs must not just sit on the splash: the driver drives through to the **homepage** and verifies real home-feed items before closing (grilling Q3).

### 3.2 Session read-only strategy (LOCKED — research §2)

- The app derives **everything** from `%APPDATA%` (`paths.ts:6-18`) — it never uses `app.getPath('userData')`.
- **Copy, don't freeze**: snapshot the resolved app-data dir (`muxics.player` or the legacy winner — `paths.ts:20-31`; `constants.ts:27-33`) into a scratch dir, launch with `APPDATA=<scratch>`. All writes (settings, caches, session rewrites, even session-**deletes** on auth failure) land in the copy. Never run against the real dir — auth-failure paths delete `session.json` (`ytmusicAuth.ts:118-123`, `ytmusicClient.ts:256-261`).
- Same-user DPAPI works on a copy (`safeStorage` on Windows), so the copied session decrypts fine.
- **Pre-warm the copy**: place yt-dlp in `<scratch>\muxics.player\ytmusic\tools\` (lazy first-run download would hit the network mid-run).
- Avoid destructive/stateful IPCs in flows: `authLogout`, `clearYtMusicCache`, `clearYtMusicMetadataCache`, `authImportSession`, playlist mutations, like/unlike.

**Read-only run procedure** (locked, from research §2.6):

1. Resolve the app-data dir the app would actually use (respect the legacy-name precedence — `paths.ts:20-31`).
2. Copy it wholesale into a scratch dir (e.g. `benchmarks/scratch/<run-id>/`), preserving the directory name so the layout is identical.
3. Optionally pre-warm the copy: pre-place yt-dlp, trim `audio\`/`artwork\` to the exact set a scenario needs, drop or add `session.json` per the profile type (§5).
4. Launch with `APPDATA=<scratch>`; the app derives everything from `%APPDATA%` and writes there unconditionally (`ensureAppDataDirs` on nearly every read).
5. Verify session validity before a real-session run: a stale/expired session makes the splash show "Signed Out" (`SplashScreen.tsx:24-151`) and can trigger the session-delete paths — safe under copy isolation, but the run's readiness check fails.
6. Tear down the scratch dir after the run; `benchmarks/runs/` (gitignored, `.gitignore:12`) holds only traces.

### 3.3 Trace transport (LOCKED — research §3)

1. Renderer DOM `CustomEvent`s (e.g. `app-navigate`, `winamp-*`) via injected listeners → `window.__muxicsTraces[]` buffer.
2. `page.on('console')` / `page.on('pageerror')`; backend logs are `[muxics:<scope>]`-prefixed (`logger.ts:3-21`).
3. Main-process stdout (`[muxics:*]` + `[muxics:bench] trace written`) via `electronApp.process().stdout`.
4. Programmatic control: `window.muxicsDesktop.request.*` from `page.evaluate` (the renderer's own accessor, `desktop.ts:36-38`) — plus real UI clicks for fidelity.
5. Optional CDP session for network/perf depth (per-window, heavier — off by default).

### 3.4 Dev-time quirks the driver must handle (LOCKED — research §4)

- **yt-dlp lazy download** to `ytmusic\tools\yt-dlp.exe` on first stream-URL/duration call — pre-place in the scratch copy (research §4.1).
- **Audio server hard-binds `127.0.0.1:46021` before window creation**; verify the port is free pre-launch; a bind error kills startup with no window (research §4.2).
- Window is `show: false` until `ready-to-show`; `frame: false`; dev opens a **detached DevTools window** — expect/ignore it (research §4.5, §4.6, §4.8).
- **Never pass `--muxics-native-host`** — it runs a headless host and exits before the GUI (research §4.4).
- "Production" foot-gun: launching without `VITE_DEV_SERVER_URL` loads built `dist/` and flips on the auto-updater — the dev path is the benchmark target (research §4.7).
- Cache eviction churn (1 GB LRU) during long streaming runs — expected and safe under copy isolation (research §4.11).

### 3.5 Tooling (LOCKED — map): `playwright` + `vitest` enter as local devDependencies (currently absent — grep in research §key-facts and `package.json:27-42`).

### 3.6 Driver visibility — visible by default, `--headless` for unattended runs (LOCKED — grilling #38-Q5)

- A benchmark batch launches the app **once per scenario** and closes it after the trace is flushed — expect repeated pop-up/close cycles during a seeding batch; the driver sequences them automatically, no interaction.
- Playwright's Electron support has **no Chromium-style headless mode** — window visibility is controlled by the app itself. Plan: **visible by default** so the driver's actions can be watched and verified (the prototype's failure mode was automation the user couldn't see), plus a `--headless` flag (env, e.g. `MUXICS_BENCH_HEADLESS=1`) that the bench-gated app honors by never showing the window — it already creates the window `show: false` until `ready-to-show` (§3.4) — and by suppressing the auto-opened detached DevTools window.
- Both modes run **identical flows, assertions, marks, and trace output** — headless is purely an unattended-batch convenience (e.g. overnight N=5 seeding). Driver assertions never depend on a human watching; visible mode exists for verification.
- **Visibility does not skew measurements — verified against the code (grilling #38-Q5):**
  - Startup: the window is already `show: false` until `ready-to-show` (`main.ts:765-785`) and the splash runs while hidden — `startup.cold/warm` timings are identical whether the window is ever shown.
  - IPC/network/playback/library: all measured by promise settlement / wall-clock — invisible to window visibility.
  - **The one exception: `render.*` paint scenarios.** They measure paint latency via post-frame marks (double `requestAnimationFrame`), and Chromium throttles `rAF`/background timers for hidden windows (the app does **not** set `backgroundThrottling`, so the default applies). Fix (locked): under the bench flag the app sets `backgroundThrottling: false` on the window, so rendering runs at full speed while invisible — identical numbers in both modes. `ready-to-show` fires regardless of visibility, so the readiness gate is unaffected.

---

## 4. Scenario catalog — LOCKED (grilling Q2 confirmed the set; scenario ids + inputs locked with it)

Map to the seven areas; each scenario is `area.flow` id, inputs, what it measures (from the prototype's record names, §2.1), expected outputs.

**Run group (LOCKED — user decision, grilling Q1): real-session only.** Benchmarks run against the **real YouTube Music session** (copied to a scratch app-data dir, §3.2) and **real local data** — no synthetic fixtures, no account-free mode. The real processes and data are the benchmark target. Local-library flows (`library.scan`, `search.local`, `playlist.open.local`, `playback.local`) run against the user's real music folders/playlists inside the copied profile.

**Execution requirement (LOCKED — user decision after the #37 prototype): runs are fully automated — zero human interaction.** The prototype's trace was collected from a manual session (the user clicked around while the app sat open in dev); that is **not** a benchmark run. The Playwright driver must drive every scenario end to end — wait on the readiness gates (§3.1), drive the real UI, collect the trace with no human input. A run that needs a human to advance it is a driver bug.

**Automation fidelity (LOCKED — grilling Q5): real UI first.** The driver performs scenarios through real clicks/keyboard on the actual DOM (search box → type → enter; playlist → click; play → observe now-playing) — a UX benchmark measures the UX. The bridge is used only for state **assertions** (logged-in readiness, §3.1), flows with no UI surface, and setup/teardown — never to bypass a flow that has a UI. **Deferred (user, grilling Q5):** a separate bridge-driven benchmark mode was requested "for later" — noted here as a future direction, out of scope for v1 of the harness.

**Scenario summary matrix** (all real-session per Q1; set confirmed, grilling Q2)

| Scenario | Area | Seeded? (§7) |
| --- | --- | --- |
| `startup.cold` / `startup.warm` | startup/splash | yes |
| `library.scan` | library | yes |
| `library.sync.yt` | library | yes |
| `search.local` | search | no (first measurement) |
| `search.remote` | search | no (first measurement) |
| `playlist.open.local` | playlists | no (first measurement) |
| `playlist.open.yt` | playlists | yes |
| `playback.cached` / `playback.stream.ytdlp-miss` / `playback.preloader-hit` | playback | yes (cached, stream) |
| `playback.local` | playback | partial (`getPlaybackUrl`) |
| `playback.advance` | playback | partial |
| `render.splash` / `render.library-list` / `render.now-playing` | rendering | no (needs new marks) |
| `ipc.burst` (diagnostic) | IPC | no (diagnostic) |

### 4.1 Startup (area: startup/splash)

| Scenario | Group | Inputs | Measures (trace + driver) | Expected outputs |
| --- | --- | --- | --- | --- |
| `startup.cold` | real-session | Fresh scratch copy of the real app-data dir (§3.2, §5); first launch of the seeding batch — app-level cold (all disk caches empty; no OS-level flush) | `initSession:*` marks + `first stage → ready` measure; startup IPCs (`authGetStatus`, `getWatchFolders`, `getSettings`, `scanFolders`, `listPlaylists`, `ytmusicLoadCachedLibrary`, `ytmusicSyncLibrary`, `ytmusicGetHomeFeed`); driver: launch→`ready-to-show`, launch→`initReady`, logged-in assertion, drive to homepage + verify real home-feed items | splash p50/p95; per-stage breakdown; per-startup-IPC table; window vs splash split; session-validated (run fails if local-only) |
| `startup.warm` | real-session | **Same scratch copy** as the preceding run, relaunched immediately (app disk caches present → hydrate-from-cache + delta-sync paths; no OS-level flush) | Same as cold | Same outputs; Δ vs cold = warm-startup win |

### 4.2 Library load & sync (area: library)

| Scenario | Group | Inputs | Measures | Expected outputs |
| --- | --- | --- | --- | --- |
| `library.scan` | real-session | Real music folders — default music path (`getDefaultMusicPath()`) + user-added watch folders from the copied profile's `settings.json`; scratch profile `cold`/`warm` | `scanFolders` (whole-scan latency); `getTrackMetadata` aggregate (count + per-call p50/p95 — noise-filtered, §2.3.4); `initSession:Scanning local library → Loading playlists` | scan latency; metadata throughput p50/p95; total library-load time |
| `library.sync.yt` | real-session | Copied session, cache.json pre-populated; network live | `ytmusicSyncLibrary`; `ytmusicLoadCachedLibrary`; `initSession:Loading YouTube Music → Almost ready` | sync latency (expected ~2.4s from seed, §7); hydrate vs sync split |

### 4.3 Search (area: search)

| Scenario | Group | Inputs | Measures | Expected outputs |
| --- | --- | --- | --- | --- |
| `search.local` | real-session | Real local library loaded in the copied profile; type a real-title fragment into search | Renderer input→results mark pair (**new production mark**, not in prototype); no IPC | local filter latency (first measurement — no seed, §7.3) |
| `search.remote` | real-session | Copied session; fixed query string | `ytmusicSearch` IPC (already timed by wrap) + renderer results mark | search API latency + UX latency (first measurement — zero records in prototype traces) |

### 4.4 Playlists (area: playlists)

| Scenario | Group | Inputs | Measures | Expected outputs |
| --- | --- | --- | --- | --- |
| `playlist.open.local` | real-session | Real playlist files present in the copied profile's `playlists\`; `loadPlaylist(path)` + UI open | `loadPlaylist`; `listPlaylists`; renderer list render mark (**new**) | open latency (first measurement) |
| `playlist.open.yt` | real-session | Copied session + cache; fixed playlistId | `ytmusicGetPlaylist` (seeded: avg 0.8–2.3s across runs, §7) + hydration marks | playlist fetch latency; hydration delta |

### 4.5 Playback matrix (area: playback)

**Cached data is in scope (LOCKED — user, grilling Q3):** `playback.cached`, the `warm-cache` profile (§5), and `playback.preloader-hit` stay. Known caveat (user's note): the app's cache layer currently has defects — cache-dependent metrics are best-effort and flagged as such in results until the cache system is repaired; fixing the cache is **out of scope** for this map.

| Scenario | Group | Inputs | Measures | Expected outputs |
| --- | --- | --- | --- | --- |
| `playback.cached` | real-session | Track whose stream + audio bytes are fully cached in the scratch copy (`audio\`, `media-index.json`) | `loadAndPlay:start→playing`; `ytmusicGetPlayback` | start→playing p50/p95 (run A cache hits: 110–509ms — §7) |
| `playback.local` | real-session | A real local file from the user's library; `getPlaybackUrl(path)` + `loadAndPlay` | `getPlaybackUrl` (seeded ~94–101ms); `loadAndPlay:start→playing`; driver `timeupdate` first data | local playback latency (first measurement for start→playing on local files) |
| `playback.stream.ytdlp-miss` | real-session | Track **not** cached; yt-dlp must fetch a stream URL (network) | `ytmusicGetPlayback` (seeded avg 8.4–8.7s, max 12.6–13.7s, §7); `loadAndPlay:start→playing` (seeded 9.5–14s, §7) | stream resolution + start→playing p50/p95 |
| `playback.preloader-hit` | real-session | After a prior playback, next track prefetched by `streamPreloader` (`useAudioEngine.ts`, `prefetchUpcomingTracks`) | `loadAndPlay:start→playing` (expect sub-second); prefetch IPC timing | prefetch effectiveness (start→playing vs `playback.stream` delta) |
| `playback.advance` | both | Queue of ≥3 tracks; auto-advance to next | consecutive `loadAndPlay` measures; prefetch overlap | per-track advance latency; prefetch hit/miss mix |

### 4.6 Rendering (area: rendering) — scenarios + mark names locked (grilling Q2, #38-Q7; no prototype marks exist)

| Scenario | Group | Inputs | Measures | Expected outputs |
| --- | --- | --- | --- | --- |
| `render.splash` | real-session | Startup run | post-frame mark after each splash stage render (**new**) | per-stage paint latency |
| `render.library-list` | real-session | Real library loaded; scroll the virtualized list (`@tanstack/react-virtual`) | first-paint + scroll-frame marks (**new**) | list first-paint; scroll frame time |
| `render.now-playing` | real-session | Play a track | now-playing view mount mark (**new**) | view mount latency |

### 4.7 IPC overhead (area: IPC) — measured implicitly everywhere

Every `desktop:request:*` call in every scenario is timed by the wrap. Additional: `ipc.burst` diagnostic (not a pass/fail flow) — counts + per-call p95 for the noise-filtered names (`getTrackMetadata`, `getFullyCachedTrackIds`) during library load. (Set locked, grilling Q2; no dedicated IPC scenarios beyond the implicit coverage + the diagnostic.)

---

## 5. Benchmark data — LOCKED: real session + real data (no synthetic fixtures)

Grilling Q1 resolved: the synthetic-fixture/account-free group is dropped. Benchmark data is the **real app-data copy** (§3.2) plus the **real local library**:

- **Session + caches**: the copied app-data dir (`session.json`, `cache.json`, `media-index.json`, `audio\`/`artwork\` caches, `playlists\`), with yt-dlp pre-placed and caches warmed per scenario (§3.2).
- **Local library**: the **default music folder** (`getDefaultMusicPath()`) plus any **user-added watch folders** from the copied profile's `settings.json` (grilling Q4 — dev environment: whatever is on the machine is what gets benchmarked). `library.scan`, `search.local`, `playlist.open.local`, and `playback.local` run against these real files.
- **Data manifest (LOCKED — grilling Q4)**: each trace's `meta` records what data the run used — music folder(s) + file counts, playlist count, session-valid?, cache sizes — so runs stay comparable as the real library changes. Compare tooling prints the manifest with results.
- **Scratch app-data profile variants** (shared with the driver):
  - `cold` — fresh copy of the real app-data dir; app-level cold (all disk caches empty). No OS-level flush — the machine's cache state is whatever it is (grilling Q3).
  - `warm` — same copy, relaunched immediately after a prior run (app disk caches present; no OS-level flush).
  - `warm-cache` — `warm` plus populated `audio\`/`artwork\` for `playback.cached`.

### 5.1 Prerequisites — what must exist before benchmarks can run (user requirement, grilling Q4)

Benchmarks run against **real files and a real session** — there are no synthetic fixtures. The driver pre-flights these before any run and refuses to start with a clear error listing which prerequisite failed:

1. **Real music files.** The default music folder and/or user-added watch folders must contain real audio files. Without them `library.scan`, `search.local`, `playlist.open.local`, and `playback.local` have nothing to measure. In dev this is simply whatever the machine has — no files are generated.
2. **A valid real YouTube Music session.** The app-data dir must contain a logged-in `ytmusic/session.json`. It gets there the normal way: log into YouTube Music inside the app once (or import a session) on the dev machine. Real-session flows (`startup.cold/warm`, `library.sync.yt`, `search.remote`, `playlist.open.yt`, `playback.cached`/`stream.ytdlp-miss`/`preloader-hit`, `render.*`) require it. A missing/stale/expired session → the run is rejected with `reason: session-not-logged-in` (never a valid trace, §3.1).
3. **Free audio-server port** `127.0.0.1:46021` (hard-bound before window creation; a bind error kills startup).
4. **yt-dlp present** in the scratch copy's `ytmusic\tools\` (pre-placed by the driver; avoids a mid-run lazy download).
5. **Toolchain**: `pnpm` + Node on the dev machine; `dist-electron/` built once (§3.1).

---

## 6. Trace format

### 6.1 Prototype schema (delivered by #37, `src/shared/bench.ts`)

```jsonc
{
  "reason": "renderer flush",            // "renderer flush" | "app quit"
  "generatedAt": "2026-08-01T19:14:58.973Z",
  "meta": {                              // app/versions for host correlation
    "appName": "muxics", "appVersion": "1.0.5",
    "platform": "win32", "arch": "arm64",
    "versions": { "electron": "43.2.0", "chrome": "150.0.7871.129", "node": "24.18.0" }
  },
  "ipc":      [{ "kind": "ipc",      "name": "desktop:request:getSettings", "start": 3972.5,  "duration": 109.6 }],
  "marks":    [{ "kind": "mark",     "name": "initSession:done",            "time": 7294.4 }],
  "measures": [{ "kind": "measure",  "name": "initSession:first stage → ready", "start": 1119.4, "duration": 6174.9 }]
}
```

Real snippet from `benchmarks/runs/2026-08-01T19-14-58-972Z.json` (run B, the clean trace): `reason: "renderer flush"`, `generatedAt: 2026-08-01T19:14:58.973Z`, 265 ipc records (e.g. `desktop:request:authGetStatus` start 1119.6 / duration 2837.1; `desktop:request:scanFolders` 106.5), 13 marks, 9 measures.

### 6.2 Production schema deltas (LOCKED — grilling #38; stub-validated parts marked as such)

| Field / change | Proposal | Grounding |
| --- | --- | --- |
| `schemaVersion` | Add `"schemaVersion": 1` (top level) — LOCKED (grilling #38-Q8) | forward-compat for compare tooling; absent in stub |
| `start`/`time`/`duration` | Epoch ms: `performance.timeOrigin + performance.now()` | §2.3.1 |
| `ipc[].seq` | Per-name sequence counter on every ipc record | §2.3.4 (burst names comparable across runs) |
| `measures` | Computed from forwarded mark timestamps (renderer-side map), no `getEntriesByName` | §2.3.3 (run A duplicate artifact) |
| `meta.host` | Add `{ cpu, ramGB }` (optional, driver-provided) | host is the user's machine; context for drift |
| Filename | Keep `<ts>.json` from `toISOString().replace(/[:.]/g, "-")`; write `.tmp` → rename | §2.3.2 atomic flush |

---

## 7. Baseline & thresholds

### 7.1 Seeding procedure (LOCKED — grilling #38-Q1)

1. Run the **seeded scenario set** (startup.cold/warm, library.scan, library.sync.yt, playlist.open.yt, playback.stream.ytdlp-miss, playback.cached, playback.advance, search.remote) **N times** on the dev machine. **N=5, LOCKED (grilling #38-Q1)** — p95 of 5 samples is the 5th-order statistic, minimal for a percentile claim; 3 is the floor if a run is dropped (e.g. a failed session assertion). All flows are real-session (grilling Q1) — seed them as a single set.
2. For each metric: drop nothing, compute **p50/p95/min/max** across runs, write `benchmarks/baseline.json`:

```jsonc
// benchmarks/baseline.json — LOCKED shape (synara acp-wire pattern)
{
  "schemaVersion": 1,
  "generatedAt": "<iso>",
  "host": { "platform": "win32", "arch": "arm64", "electron": "43.2.0" },
  "runIds": ["2026-08-01T19-14-58-972Z.json", "..."],
  "metrics": {
    "startup.splash.ready": { "p50Ms": 6175, "p95Ms": 6349, "n": 5 },
    "playback.stream.ytdlp-miss.startToPlaying": { "p50Ms": 9978, "p95Ms": 13974, "n": 5 }
  }
}
```

3. Write `benchmarks/thresholds.json` with **relative %** (defaults proposed below) and **absolute guards** (computed per-metric from the seeding runs, rule proposed below).

**Worked example** (how §7.3's seeds become the checked-in files): run `startup.cold` 5× on the dev machine → 5 values for `startup.splash.ready`; `p50` and `p95` of those 5 land in `baseline.json.metrics["startup.splash.ready"]` (`{ p50Ms, p95Ms, n: 5 }`). `thresholds.json` then holds the guard for that metric, e.g. `{ "startup.splash.ready": { "absoluteMs": 12500 } }` from the §7.2 rule applied to the *fresh* baseline p50 — the §7.3 seed table only shows what the first baseline is *expected* to look like, not the baseline itself. The compare tool never reads §7.3-style single samples; it only compares runs against `baseline.json`.

### 7.2 Threshold rules (LOCKED — grilling #38-Q2)

**Two failure axes (user clarification, grilling #38-Q2):**

1. **Functional failure — hard, no formula.** The driver's assertions decide: error thrown, no data returned, expected element/string not found, wrong state (e.g. local-only when logged-in expected) → the flow/run is **failed** and excluded from baselines (§4 "expected outputs", §3.1 readiness).
2. **Performance regression — advisory, report-only.** Measured p50/p95 are always reported raw; the guards below only **color rows**. Per the map's locked decision, a breach prints a flag but **never fails the process** unless `--fail` (see §10).

- **Relative guards (defaults, LOCKED)**: p50 breach at **+50%**; p95 breach at **+100%**. Per-metric overrides allowed in `thresholds.json`.
- **Absolute guard rule (LOCKED)**: `absoluteMs = max(2 × baseline.p50, 1.5 × max(p95, observed max))` — the max term keeps the guard above anything observed in seeding, so a noisier network day doesn't false-positive; the 2×p50 term catches slow drifts on quiet metrics. Computed numbers for the initial seeds in §7.3.

### 7.3 Initial seeded numbers — extracted from the prototype traces

Each row is a **1-sample seed** (n=1 run, or per-IPC aggregate over n calls within one run). **p50/p95 are NOT yet measurable** — they only exist after the §7.1 seeding runs. Values are network-dependent where noted.

| Metric | Run A `2026-08-01T19-12-24-540Z.json` | Run B `2026-08-01T19-14-58-972Z.json` (clean) | Seed used (source) | Locked absolute guard (rule from §7.2) |
| --- | --- | --- | --- | --- |
| `startup.splash.ready` (first stage → ready) | 6349ms | 6175ms | 6175ms (run B) | 12.5s (2× seed) |
| `startup.authGetStatus` | 2994ms (n=1) | 2837ms (n=1) | 2837ms (run B) | 5.7s (2× seed) |
| `startup.ytmusicSyncLibrary` | 2275ms (n=1) | 2431ms (n=1) | 2431ms (run B) | 4.9s (2× seed) |
| `startup.ytmusicGetHomeFeed` | 3293ms (n=1) | 3584ms (n=1) | 3584ms (run B) | 7.2s (2× seed) |
| `playlist.open.yt` (`ytmusicGetPlaylist`) | avg 2262ms, p50 925, max 5247 (n=3) | avg 796ms, p50 535, max 1461 (n=3) | p50 535ms, max 1461 (run B) | 2.2s (1.5× max) |
| `playback.stream.ytdlp-miss` (`ytmusicGetPlayback`) | avg 8697ms, p50 8226, p95 11877, max 12624 (n=31) | avg 8391ms, p50 8252, p95 13661, max 13661 (n=18) | p50 8252ms, max 13661 (run B) | 20.5s (max(2×p50, 1.5×max)) |
| `playback.stream.ytdlp-miss` (`loadAndPlay start→playing`) | 10966, 12173, 8124, 9499, 9893, … 160–509ms cache hits (n=10) | 9515, 9978, 13974 (n=3) | p50 9978ms (run B, stream samples) | 20s (2× p50) |
| `playback.cached` (`loadAndPlay start→playing`) | 457, 499, 509, 160, 110ms (run A cache/preloader hits) | — | 500ms (run A median of hits) | 1s (2× seed) |
| `library.scan` (`scanFolders`) | 86ms (n=1) | 107ms (n=1) | 107ms (run B) | 220ms (2× seed) |
| `library.scan` (`getTrackMetadata` per call) | avg 32ms, p50 26, p95 73, max 102 (n=210) | avg 26ms, p50 22, p95 50, max 124 (n=210) | p50 22ms, max 124 (run B) | 250ms per call (2× max); **diagnostic, not pass/fail** |
| `library.getFullyCachedTrackIds` | avg 29ms, p50 12, p95 96, max 210 (n=112) | avg 279ms, p50 2, p95 1522, max 1522 (n=26) | — | **no guard** — noise-filtered diagnostic (§2.3.4) |
| `playback.local` (`getPlaybackUrl`) | avg 94ms, max 101 (n=2) | — | 100ms (run A) | 200ms (2× seed) |
| `startup.ytmusicLoadCachedLibrary` | 28ms (n=1) | 44ms (n=1) | 44ms (run B) | 100ms (2× seed) |

Splash stage decomposition (from run B measures): auth→scan 2845ms (≈ `authGetStatus` 2837ms), scan→playlists 1.6ms, playlists→yt 0.4ms, yt→sync 676ms (≈ `ytmusicLoadCachedLibrary` + hydrate), sync→almost 2445ms (≈ `ytmusicSyncLibrary` 2431ms), then a 200ms settle tick to `initSession:done` (`sessionInit.ts`).

**Not yet measurable (explicitly, no seed):** `search.local`, `search.remote` (`ytmusicSearch` — zero records in both prototype traces), `playlist.open.local`, `render.*`, local-file `loadAndPlay`. These get their **first** measurements from the production layer; their baselines come from the §7.1 seeding runs.

### 7.4 Baseline lifecycle (LOCKED — grilling #38-Q9)

- Re-seeding happens **only** on an explicit `pnpm bench:baseline` — it re-runs the seeded scenario set (N=5, §7.1) and regenerates `benchmarks/baseline.json` + `benchmarks/thresholds.json`, using the same driver code as normal runs. Baselines never change on their own.
- **Staleness warning**: `bench:compare` compares each trace's `meta` (`electron`/`chrome`/`node` versions, `arch`) against the baseline's `host`; a mismatch prints "baseline predates this toolchain — consider re-seeding" as a warning. Never an automatic re-seed.

---

## 8. Flow registry (LOCKED — grilling #38-Q4)

**Purpose** (locked, from map): a generated manifest of every user flow and its timings — the cross-run summary view.

**Format proposal** — `benchmarks/registry.json`:

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "<iso>",
  "sourceRuns": ["2026-08-01T19-14-58-972Z.json", "..."],
  "flows": [{
    "id": "playback.stream.ytdlp-miss.startToPlaying",
    "area": "playback", "scenario": "playback.stream.ytdlp-miss",
    "name": "loadAndPlay:start → playing",
    "count": 3, "minMs": 9515, "p50Ms": 9978, "p95Ms": 13974, "maxMs": 13974,
    "samplesMs": [9515, 9978, 13974]
  }]
}
```

**Generation mechanism (LOCKED — grilling #38-Q4): script-only.** A script `benchmarks/registry.ts` (run via `pnpm bench:registry`) reads the scenario catalog's measure definitions (a shared `benchmarks/scenarios.ts` module both the driver and registry import), maps each trace's ipc/marks/measures into flow records, and aggregates across all runs in `benchmarks/runs/`. The registry must span **multiple runs** to have p50/p95, so it can't live inside a single trace. The app stays a pure instrument; all interpretation lives in tooling. (The in-trace `flows[]` alternative was rejected — it's per-run only and adds app-side logic.)

---

## 9. Dev-only benchmark mode + recorder UI surface (LOCKED — grilling #38-Q3)

- **Gate (LOCKED)**: `MUXICS_BENCH=1` env var — the prototype's flag, dev-only, zero cost when off (§2.1).
- **Recorder surface (LOCKED — grilling #38-Q3)**: option **(a) menu item** — when `MUXICS_BENCH=1`, add a dev-only "Benchmarks" menu (main-process `Menu`) with "Open last run" → renderer modal/route showing the summary table (reuses the §10 compare logic). Needs one new IPC `desktop:bench:getLatestRun` returning the latest `benchmarks/runs/*.json` path + records. The viewer is implemented as the same table component the compare CLI prints.

---

## 10. Compare / report tooling (LOCKED — grilling #38-Q5)

- **Script**: `benchmarks/compare.ts`, run via `pnpm bench:compare -- <run-files...>`.
- **Runner**: the dev machine runs Node 24.18.0 (trace `meta`), which executes `.ts` natively (type-stripping) — **no runner dependency** (no `tsx`).
- **Behavior**:
  - Loads `benchmarks/baseline.json` + `benchmarks/thresholds.json` (paths overridable via `--baseline` / `--thresholds`).
  - Computes p50/p95 (and count/min/max) per metric from the given run file(s) — reusing the same statistics code as the registry (§8).
  - Prints a console table: `metric | baseline p50/p95 | current p50/p95 | Δ% | guard | status (PASS/FAIL)`.
  - **Report-only by default**: breaches print FAIL rows; **exit code 0**. `--fail` exits 1 when any guard breaches. `--json <out>` emits machine-readable results.
  - Noise-filtered names (`getTrackMetadata`, `getFullyCachedTrackIds`) appear as diagnostics rows only, never fail the run (§2.3.4).
- **Tests**: vitest unit tests for the stats (p50/p95 on known arrays) and guard logic — vitest is already locked as a devDep (§3.5).

---

## 11. Locked-decision index (all grilling questions resolved — design LOCKED)

Every decision is recorded inline, marked `(LOCKED — ...)`. Summary of what was agreed:

- **Run groups** (Q1): real-session only — no synthetic fixtures (§4).
- **Catalog** (Q2): 14 first-class flows, all real-session (§4).
- **Startup** (Q3): cold = fresh scratch copy / app-level cold, no OS flush; warm = same copy relaunched. Session-validated readiness — local-only mode aborts the run (`session-not-logged-in`). Cached data in scope; cache-layer defects are a known caveat (§4, §3.1).
- **Local data + prerequisites** (Q4): default music folder + user-added watch folders; prerequisites documented in §5.1.
- **Automation** (Q5): zero human interaction; real UI first; bridge-driven mode deferred (§4).
- **Seeding** (#38-Q1): N=5, floor 3 (§7.1).
- **Thresholds** (#38-Q2): two axes — functional failures hard (no formula), performance guards advisory/report-only; relative +50% p50 / +100% p95; absolute `max(2×p50, 1.5×max)` (§7.2).
- **Recorder surface** (#38-Q3): menu item + `desktop:bench:getLatestRun` (§9).
- **Flow registry** (#38-Q4): script-only `benchmarks/registry.ts` (§8).
- **Report CLI** (#38-Q5): `bench:compare`, native `.ts`, report-only + `--fail`/`--json` (§10).
- **Driver visibility** (#38-Q5): visible by default; `--headless` env flag; `backgroundThrottling: false` under the bench flag so render marks are unaffected (§3.6).
- **Record transport** (#38-Q6): batched, ~100ms + final flush (§2.3).
- **Mark set** (#38-Q7): `nav:*`, `render:*`, `search:input/results`, `library:visible` (§2.3).
- **Channel naming** (#38-Q8): `desktop:bench:v1:*`, `schemaVersion: 1`, contract types in `src/shared/bench-contract.ts` (§2.3, §6.2).
- **Baseline lifecycle** (#38-Q9): explicit `bench:baseline` + staleness warning (§7.4).
