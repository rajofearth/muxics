# Benchmark Driver Research — Dev-Session Driver Mechanics

Issue: #36 · Repo: `rajofearth/muxics` · Purpose: feed the design of a local benchmark
system whose Playwright Electron driver attaches to the dev app, exercises user flows,
and collects instrumentation traces **without disturbing the real YouTube Music session**.

Method: every claim below is traced to its primary source — repo code (`path:line`) or
an official Electron / Playwright / Vite / pnpm doc URL. Nothing is inferred from
secondary write-ups. `path:line` refs are relative to the repo root
(`P:\Projects\winamp-player`).

---

## Key facts the driver design depends on

| Fact | Value |
| --- | --- |
| Exact dev launch | `pnpm exec tsup --config tsup.electron.config.ts` (once) → start `pnpm exec vite --port 5173` (binds `127.0.0.1:5173`, strict) → `_electron.launch({ args: ['.'], env: { VITE_DEV_SERVER_URL: 'http://localhost:5173', ...process.env } })` |
| Real session on disk | `%APPDATA%\muxics.player\ytmusic\session.json` (default) — Windows config root from `%APPDATA%`, app-data id `muxics.player`, legacy dirs checked first |
| Session isolation for read-only runs | Copy the resolved app-data dir to a scratch dir and launch with `APPDATA=<scratch>`; the app derives everything from `%APPDATA%` and writes there unconditionally |
| Recommended trace transport | 1) Renderer DOM `CustomEvent`s + `page.on('console')`/`page.on('pageerror')` (zero app changes), 2) main-process stdout (`[muxics:<scope>]` logs) via `electronApp.process().stdout`, 3) `window.muxicsDesktop.request.*` from `page.evaluate` for programmatic control, 4) optional CDP for network/perf traces |
| `playwright` dependency | **Not present** (devDeps + whole repo grep: 0 matches) — must be added as a devDependency |
| Existing file-based traces | Only `ytmusic\debug\*.json` dumps (`MUXICS_YTMUSIC_SYNC_DEBUG=1` or setting `ytmusicLibrarySyncDebug`). **No `benchmarks/` dir or `runs/<ts>.json` exists anywhere** |
| Ports to guard | Audio server hard-binds `127.0.0.1:46021` **before** window creation; app fails to start if busy. Vite `5173` strictPort. No port-offset env vars exist |
| First-run downloads | yt-dlp binary auto-downloaded (dev) to `ytmusic\tools\yt-dlp.exe` lazily on first playback/duration call — not at startup |

---

## 1. Programmatic dev launch on Windows

### Script chain (`package.json`)

- `"main": "dist-electron/main.cjs"` — `electron .` resolves its entry from this field (`package.json:8`).
- `"predev": "tsup --config tsup.electron.config.ts"` (`package.json:10`) — pnpm runs the `pre*` script before `dev` automatically (https://pnpm.io/scripts). One-shot build of the Electron entrypoints.
- `"dev": "concurrently -k \"vite --port 5173\" \"tsup --config tsup.electron.config.ts --watch\" \"cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron .\""` (`package.json:11`) — three concurrent processes: Vite dev server, tsup watch, Electron with the dev-server URL. `-k` kills the whole group when any one exits; `cross-env` exists because inline env assignment doesn't work in Windows `cmd`.
- `"build": "vite build && tsup --config tsup.electron.config.ts"` (`package.json:12`) — production renderer to `dist/` + entrypoints to `dist-electron/`.
- Package manager is pnpm (`packageManager: pnpm@11.13.0`, `package.json:7`); `pnpm-workspace.yaml` only allows Electron's build scripts (not a monorepo).

### Build outputs

- **tsup** (`tsup.electron.config.ts:4-19`): entries `src/electron/main.ts` → `dist-electron/main.cjs` and `src/electron/preload.ts` → `dist-electron/preload.cjs`; CJS, `target: node20`, `clean: true`, `external: ["electron", "electron-updater"]`. `dist-electron/` is gitignored (`.gitignore:3`), so a clean checkout must run this step before `electron .` works.
- **Vite** (`vite.config.ts:5-26`): `root: "src/mainview"`, `base: "./"`, build `outDir: "../../dist"`, dev server `host: "127.0.0.1"`, `port: 5173`, `strictPort: true` (Vite exits if 5173 is taken — https://vitejs.dev/config/server-options.html).

### How `main.ts` decides dev vs prod (`src/electron/main.ts`)

- `getRendererEntry()` (`main.ts:86-93`): returns `process.env["VITE_DEV_SERVER_URL"]` if set, else `null`. This env var is the **only** dev/prod switch.
- `createMainWindow()` (`main.ts:696-750`):
  - `await startAudioServer()` first (`main.ts:697`) — the HTTP audio server must bind before the window is created.
  - Window options (`main.ts:704-720`): `frame: false`, `show: false` (shown on `ready-to-show`, `main.ts:722-724`), `preload: dist-electron/preload.cjs`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`.
  - If a dev URL exists → `mainWindow.loadURL(devUrl)` **and `mainWindow.webContents.openDevTools({ mode: "detach" })`** (`main.ts:736-738`) — DevTools auto-open is a dev-only behavior.
  - Else → `mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"))` (`main.ts:740`).
- Auto-updater runs **only** when `VITE_DEV_SERVER_URL` is unset (`main.ts:761-785`) — i.e. the dev path also disables updater network chatter. (Corollary: launching against the built `dist/` without the env var flips into "production" and triggers `autoUpdater.checkForUpdatesAndNotify()`.)
- Windows AppUserModelId is set to `dev.muxics.player` (`main.ts:753-755`, `src/shared/constants.ts:26`).
- `process.argv.includes("--muxics-native-host")` at the very top (`main.ts:66-68`) runs a headless native-messaging host instead of the GUI (used by the browser-extension bridge manifest, `src/electron/backend/browserBridge.ts:65-70`).

### Exact driver launch sequence (recommended)

Do **not** reuse `pnpm dev` — `concurrently -k` makes the process tree hard to manage from a driver and tsup watch is unnecessary. Orchestrate the three steps yourself:

1. **Install** (once): `pnpm install` (pnpm 11; `package.json:7`).
2. **Prebuild entrypoints** (once per checkout): `pnpm exec tsup --config tsup.electron.config.ts` → produces `dist-electron/main.cjs` + `dist-electron/preload.cjs` (required because `"main"` points there, `package.json:8`; gitignored, `.gitignore:3`).
3. **Start Vite** as a child process: `pnpm exec vite --port 5173` (binds `127.0.0.1:5173`; `strictPort` — fail fast if taken, `vite.config.ts:22-26`).
4. **Launch Electron via Playwright**:
   ```ts
   const app = await electron.launch({
     args: ['.'],                          // `electron .` → reads package.json "main"
     cwd: repoRoot,
     env: { VITE_DEV_SERVER_URL: 'http://localhost:5173', ...process.env },
   });
   ```
   Playwright resolves the Electron binary from the installed `electron` devDependency and treats `args[0]` as the app path (https://playwright.dev/docs/api/class-electron, https://playwright.dev/docs/api/class-electronapplication). Setting env vars directly in the child `env` object avoids `cross-env` entirely (it is only needed for cmd-line invocation).
5. **Wait for readiness**: audio server bound on `127.0.0.1:46021` (happens before window creation), first window `ready-to-show`, splash dismissed (`_initReady`, see §4), and — if the run plays YT tracks — yt-dlp binary present or its first-run download allowed (§4).

### Env vars that matter

| Var | Effect | Source |
| --- | --- | --- |
| `VITE_DEV_SERVER_URL` | Switches renderer to `loadURL` + detached DevTools + disables auto-updater | `main.ts:86-93,736-738,761-785` |
| `APPDATA` (win32) | Overrides the config root the app uses for **all** its data | `paths.ts:9-11` |
| `USERPROFILE` | Only affects the *default* music folder (`getDefaultMusicPath`) | `paths.ts:50-53` |
| `MUXICS_YTMUSIC_SYNC_DEBUG=1` | Enables verbose library-sync debug dumps | `ytmusicData.ts:225-230` |

---

## 2. Where the real YouTube Music session lives on disk

### Path resolution — NOT `app.getPath('userData')`

`APP_DATA_PATH` (`src/electron/backend/paths.ts:33`) is derived entirely from `os.homedir()` / env vars and a hardcoded app-data id — the app **never calls `app.getPath('userData')` or `app.setPath`** (grep of `src/electron`: no matches).

- `getConfigRoot()` (`paths.ts:6-18`): win32 → `process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming")`.
- `resolveAppDataPath()` (`paths.ts:20-31`): returns the **first existing** of `[APP_DATA_ID, ...LEGACY_APP_DATA_IDS]` = `["muxics.player", "muse.player", "muse.electrobun.dev", "winampplayer.electrobun.dev"]` (`src/shared/constants.ts:27-33`); default `%APPDATA%\muxics.player`. Legacy dirs take precedence if present (a migration quirk — the real session may live in an old dir).
- Electron's Chromium profile (`userData`) is a **separate** default location (`%APPDATA%\muxics` in dev, from the package name) — the app's own data and the browser profile are independent.

### Complete inventory of session-related files (`paths.ts:34-45`)

| File / dir | Meaning | Written by |
| --- | --- | --- |
| `settings.json` | App settings incl. `allowPlaintextYtMusicSession`, cache limits, `ytmusicLibrarySyncDebug` | `settings.ts:82-85` |
| `playlists\` | Local `.m3u8` playlists | `playlists.ts:93-103` |
| `ytmusic\session.json` | **The session credential** — `{encrypted, value, createdAt, updatedAt}`; `value` is base64 of `safeStorage`-encrypted `{kind:"cookie",cookie}` or `{kind:"oauth",oauth}` | `ytmusicSession.ts:56-78,111-121` |
| `ytmusic\cache.json` | Cached library (tracks/playlists) + `lastSyncedAt` | `ytmusicData.ts:84-87` |
| `ytmusic\home-snapshot.json` | Last home feed for instant cold display | `ytmusicHomeSnapshot.ts:20-27` |
| `ytmusic\search-cache.json` | Search result cache (epoch + entries) | `ytmusicSearchCache.ts:44-51` |
| `ytmusic\media-index.json` | Cache index (sha1 keys → audio/artwork files), debounced 450 ms flush + flush on `beforeExit` | `ytMusicCache.ts:119-148` |
| `ytmusic\debug\` | Debug dumps (library landing/songs/playlists JSON) | `ytmusicData.ts:232-242,459-463` |
| `ytmusic\tools\` | yt-dlp binary (dev auto-download) | `ytdlp.ts:60-103` |
| `ytmusic\audio\`, `ytmusic\artwork\` | Media cache (warm-to-disk streaming, LRU eviction at 1 GB default limit) | `ytMusicCache.ts:217-259,374-446` |

### How the app reads the session

- `loadStoredYtMusicSession()` reads + decrypts `session.json` (`ytmusicSession.ts:99-109`; `decodeSession` L80-97; `safeStorage` — DPAPI on Windows, https://www.electronjs.org/docs/latest/api/safe-storage). If encryption is unavailable, plaintext is only persisted when `allowPlaintextYtMusicSession` is enabled (`ytmusicSession.ts:56-78`).
- `getClient()` → `restoreClientFromDisk()` (`ytmusicClient.ts:265-283,232-263`): restores an Innertube client from the stored cookie or OAuth tokens; reuses the cached client only while `session.json`'s `updatedAt` is unchanged.
- `getYtMusicAuthStatus()` → `buildAuthStatus()` reads session + `cache.json` `lastSyncedAt` (`ytmusicAuth.ts:82-135`).
- `getYtMusicSessionCookie()` serves the cookie to the audio server proxy and yt-dlp (`ytmusicClient.ts:290-300`; `audioServer.ts:286-291`).

### Write paths — what a benchmark run will touch (must be isolated)

The app writes constantly during normal use; it also has **destructive** session paths:

- **Deletes `session.json`**: `clearStoredYtMusicSession()` (`ytmusicSession.ts:141-146`) is called on OAuth restore failure (`ytmusicClient.ts:256-261`), on auth-failure regex `401|403|unauthor|sign in|expired` during status build (`ytmusicAuth.ts:118-123`), on logout (`ytmusicAuth.ts:286-298`), and on rejected imports (`ytmusicAuth.ts:224-226`).
- **Rewrites `session.json`**: import/save flows (`ytmusicAuth.ts:206,271`) and OAuth token refresh events `client.session.on("auth"/"update-credentials")` (`ytmusicClient.ts:219-230`).
- **Rewrites caches**: library sync → `cache.json` (`ytmusicData.ts:84-87`); cache hits/LRU touches → `media-index.json` (450 ms debounce + `beforeExit`, `ytMusicCache.ts:119-148,309-319`); audio/artwork downloads and eviction (`ytMusicCache.ts:217-259,374-446`); search/home snapshot files; yt-dlp temp cookie files `yt-dlp-cookies-<uuid>.txt` (created + removed per call, `ytdlp.ts:129-175,255-259`).
- **Creates dirs unconditionally**: `ensureAppDataDirs()` runs on nearly every read (e.g. `settings.ts:31-32`, `ytmusicSession.ts:100`).

### What a read-only benchmark run must do

1. **Copy, don't freeze.** True read-only semantics on the real dir are impossible — the app `mkdir`s and rewrites files on every startup/flow. Instead, snapshot the resolved app-data dir (see §2 path resolution; include the legacy name if present) into a scratch dir and launch the app with `APPDATA=<scratch>` (`paths.ts:9-11`). The app then uses `<scratch>\muxics.player` (or the same legacy name, preserving the exact layout). All writes, cache churn, and even the session-delete paths land in the copy; the real session is untouched.
2. **Same-user encryption works.** `safeStorage` on Windows is user-scoped DPAPI; a copy made by the same Windows account decrypts fine.
3. **Avoid destructive/stateful IPC**: `authLogout`, `clearYtMusicCache`, `clearYtMusicMetadataCache`, `authImportSession`, `saveSettings` (unless intended), playlist mutations, `ytmusicLike/Unlike` (`desktop-contract.ts:153-235` lists the surface).
4. **Pre-warm or allow yt-dlp download** in the copy's `ytmusic\tools\` to avoid a network fetch mid-benchmark (§4).
5. **Verify session validity before the run**: a stale/expired session makes the app show the "Signed Out" splash and can trigger the auto-delete paths (`ytmusicAuth.ts:120-123`) — safe under copy isolation, but it will fail the run's readiness check.

---

## 3. How a Playwright Electron driver can collect traces

### Channels that exist today

1. **Renderer DOM `CustomEvent`s** (zero-instrumentation, event-driven):
   - Preload dispatches on `document`: `winamp-context-action`, `winamp-menu-action` (`preload.ts:122-133`), `muxics-yt-cache-stats`, `muxics-auto-update` (`preload.ts:135-151`).
   - Renderer dispatches `app-navigate` (view changes: library / now_playing / search / settings) (`src/mainview/App.tsx:99-113`, also `SplashScreen.tsx:108-111`).
2. **Renderer console + page errors**: all renderer `console.*` output and React errors surface through Playwright `page.on('console')` / `page.on('pageerror')` (https://playwright.dev/docs/api/class-page#page-event-console). The backend logs through `src/electron/backend/logger.ts` with a stable prefix `[muxics:<scope>]` (`logger.ts:3-21`).
3. **Main-process stdout/stderr**: `logger.ts` and `main.ts` write `[muxics:*]` lines to the Electron main process stdio — capture them from the driver via `electronApp.process().stdout/.stderr` (https://playwright.dev/docs/api/class-electronapplication#electron-application-process). This captures ytmusic/ytdlp/audio-server/updater scopes with no app changes.
4. **Programmatic control via the exposed bridge**: `contextBridge.exposeInMainWorld("muxicsDesktop", desktopBridge)` (`preload.ts:153`) exposes the full `DesktopBridge` (request + send maps, `src/shared/desktop-contract.ts:153-253`) into the **page main world**, so `page.evaluate(() => window.muxicsDesktop.request.ytmusicGetPlayback({...}))` works (the renderer uses the same `window.muxicsDesktop` accessor, `src/mainview/desktop.ts:36-38`). IPC is registered on `desktop:request:*` / `desktop:message:*` (`main.ts:680-694`). This lets a driver run instrumented flows (search → get playback → get cache stats) without clicking, plus UI clicks for realism.
5. **CDP**: Playwright Electron supports `electronApp.context().newCDPSession(page)` (https://playwright.dev/docs/api/class-electronapplication) for network/perf traces (e.g. googlevideo request timing). Heavier, per-window, optional.
6. **Files the app writes itself**: only `ytmusic\debug\*.json` dumps exist as a file-based trace — gated by `MUXICS_YTMUSIC_SYNC_DEBUG=1` or the `ytmusicLibrarySyncDebug` setting (`ytmusicData.ts:225-230`, dumps at `ytmusicData.ts:459-463`).

### What does NOT exist yet

- **No `benchmarks/` dir, no `runs/<ts>.json`, no trace/instrumentation infrastructure anywhere** in the repo (grep for `benchmark`/`playwright` across `src`, configs, docs, workflows: 0 matches). The designed `benchmarks/runs/<ts>.json` output would be **new app-side instrumentation** (a follow-up task); until then the driver can own a `benchmarks/runs/` dir and write its own JSON next to the app's `YTMUSIC_DEBUG_DIR` artifacts.

### Recommendation

- **Primary transport: renderer DOM events + console capture** (`page.evaluate`-injected `CustomEvent` listeners into a `window.__muxicsTraces[]` buffer, plus `page.on('console')`/`page.on('pageerror')`). No app changes, works today, and the app already emits structured events.
- **Secondary: main-process `[muxics:*]` stdout parsing** for backend scopes (ytdlp, audio-server, ytmusic).
- **Control: `window.muxicsDesktop.request.*` via `page.evaluate`** for deterministic flows (with real UI clicks layered on for fidelity).
- **Optional depth: CDP session** on the page for network/perf metrics.
- **Playwright must be added as a devDependency** (currently absent from `package.json:27-42`).

---

## 4. Dev-time quirks on this codebase

1. **yt-dlp first-run download** — In dev (`app.isPackaged` false), `ensureYtDlpBinary()` downloads `yt-dlp.exe` from GitHub releases (`BINARY_URLS`, `ytdlp.ts:18-24`) into `YTMUSIC_TOOLS_DIR` (`ytmusic\tools\`) **lazily on the first stream-URL/duration call** (`ytdlp.ts:60-103,204,276`) — not at startup. Packaged builds expect the binary in `extraResources/bin` (`electron-builder.yml:14-18`; `ytdlp.ts:39-49`). Each call also writes a throwaway `yt-dlp-cookies-<uuid>.txt` in `ytmusic\` (deleted in `finally`, `ytdlp.ts:255-259`). **Driver:** pre-place the binary in the scratch app-data copy, or budget network time on first play.
2. **Audio-server port 46021** — Hardcoded `AUDIO_SERVER_PORT = 46021` (`constants.ts:28`); `startAudioServer()` listens on `127.0.0.1:46021` and is **awaited before window creation** (`main.ts:697`; `audioServer.ts:534-537`); a bind error rejects and the app never shows a window (logged via the `unhandledRejection` handler, `main.ts:70-72`). **No port-offset env var exists.** **Driver:** verify 46021 is free before launch.
3. **App-data path resolution quirks** — `%APPDATA%` env override (`paths.ts:9-11`); **legacy dirs win**: if `%APPDATA%\muse.player` (etc.) exists, it is used instead of `muxics.player` (`paths.ts:20-31`; `constants.ts:29-33`). Independent of Chromium's `userData` (`%APPDATA%\muxics` in dev). The app never touches `app.getPath('userData')`.
4. **Dev-only flags and env vars** — `VITE_DEV_SERVER_URL` (dev renderer + **detached DevTools auto-open** `main.ts:736-738` + updater disabled `main.ts:761-785`); `MUXICS_YTMUSIC_SYNC_DEBUG=1` (`ytmusicData.ts:225-230`); `--muxics-native-host` (headless native-messaging mode — **never pass it in a benchmark**; it exits before the GUI, `main.ts:66-68`); `APPDATA` / `USERPROFILE` overrides.
5. **Startup staging to wait on** — Window is created `show: false` and shown on `ready-to-show` (`main.ts:712,722-724`). Renderer shows a `SplashScreen` until `_initReady` (`App.tsx:158-161`), set after: `loadAuthStatus` → `loadLibrary` → `loadPlaylists` → `hydrateYtMusicFromCache` (if logged in) → `syncYtMusicLibrary` + a 200 ms settle tick (`src/mainview/store/sessionInit.ts:12-97`). A **stale/expired session leaves the splash in a "Signed Out" state** (`SplashScreen.tsx:24-151`) — treat that as a readiness failure, not a loaded app. Renderer load failures surface via `did-fail-load` logging (`main.ts:731-733`).
6. **DevTools window in dev** — Dev mode opens a detached DevTools window; the driver must expect/ignore an extra window (or accept it as a side effect of the `VITE_DEV_SERVER_URL` path).
7. **"Production" foot-gun** — Launching `electron .` **without** `VITE_DEV_SERVER_URL` loads `dist/index.html` (built renderer) but also enables the auto-updater's network update check (`main.ts:761-785`). The dev path is the cleaner benchmark target.
8. **Frameless window** — `frame: false` (`main.ts:710`); window chrome is custom-rendered. Not a blocker for Playwright, but selectors must target the custom title bar, and `ready-to-show` is the reliable first-paint signal.
9. **`pnpm dev` process group** — `concurrently -k` (`package.json:11`) kills all three processes when any exits; a driver should orchestrate vite/electron itself rather than wrap `pnpm dev`.
10. **Session-destructive paths** (recap for safety) — auth-failure and restore-failure paths **delete `session.json`** (`ytmusicAuth.ts:118-123`, `ytmusicClient.ts:256-261`); OAuth refresh **rewrites** it (`ytmusicClient.ts:219-230`). Under `APPDATA` copy isolation these are harmless; on the real dir they would sign the user out.
11. **Cache eviction churn** — Default cache limit 1 GB (`settings.ts:22`) with LRU deletion during runs (`ytMusicCache.ts:217-259`); a long benchmark that streams much audio will churn the copy's `audio\`/`artwork\` dirs — expected and safe under isolation.

---

## Appendix — source index

Repo files (all paths relative to `P:\Projects\winamp-player`):

- `package.json:7-14,27-42` · `vite.config.ts:5-26` · `tsup.electron.config.ts:4-19` · `electron-builder.yml:1-18` · `.gitignore:3` · `pnpm-workspace.yaml`
- `src/electron/main.ts:66-68,86-93,153-159,680-694,696-750,752-792`
- `src/shared/constants.ts:25-33` · `src/shared/desktop-contract.ts:153-253`
- `src/electron/preload.ts:122-153`
- `src/electron/backend/paths.ts:6-66` · `settings.ts:4-85` · `ytmusicSession.ts:7-146` · `ytmusicClient.ts:200-311` · `ytmusicAuth.ts:82-298` · `ytmusicData.ts:68-87,225-242,459-463` · `ytMusicCache.ts:119-148,217-259,309-319,374-491` · `ytdlp.ts:18-103,121-259,335-342` · `audioServer.ts:73-155,215-431,451-546` · `logger.ts:3-21` · `ytmusicHomeSnapshot.ts:20-27` · `ytmusicSearchCache.ts:44-51` · `browserBridge.ts:65-70`
- `src/mainview/desktop.ts:36-38` · `App.tsx:47-57,99-161` · `main.tsx:9-17` · `store/sessionInit.ts:12-97` · `components/SplashScreen.tsx` · `index.html`
- `.github/workflows/build.yml` (CI: `pnpm install` → `pnpm run build` → electron-builder; no dev-launch pattern)

Official docs:

- Playwright Electron: https://playwright.dev/docs/api/class-electron · ElectronApplication (process, evaluate, context): https://playwright.dev/docs/api/class-electronapplication · page console event: https://playwright.dev/docs/api/class-page#page-event-console
- Electron `app.getPath` (userData semantics): https://www.electronjs.org/docs/latest/api/app#appgetpathname · `safeStorage` (DPAPI on Windows): https://www.electronjs.org/docs/latest/api/safe-storage · `contextBridge` + `contextIsolation` (isolated vs main world): https://www.electronjs.org/docs/latest/api/context-bridge and https://www.electronjs.org/docs/latest/tutorial/context-isolation
- pnpm pre/post lifecycle scripts: https://pnpm.io/scripts · Vite server options (`strictPort`): https://vitejs.dev/config/server-options.html
