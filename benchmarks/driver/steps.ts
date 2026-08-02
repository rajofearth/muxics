// Scenario UI steps (issues #42 + #43 + #44) — real clicks/keyboard on the
// actual DOM, per the design's automation-fidelity lock (§4): the bridge is
// used only for state assertions; every flow with a UI surface is driven
// through the UI.
//
// These are the post-readiness steps the runner passes into runLaunchCycle for
// the library, search, playlist, playback, and rendering scenarios. Each step
// ends only when the DOM shows the outcome it was driving toward, so the
// marks/measures/IPCs the step produces are guaranteed to be recorded before
// the app closes.
import type { Page } from "playwright";
import { DriverFailure } from "./driver";

const TAG = "[bench:steps]";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sidebar "All Songs" → the library track list (§4.2 library.scan steps). */
export async function openLibraryView(page: Page): Promise<void> {
  console.log(`${TAG} opening the library view...`);
  // The nav button shows the track count too, so match the label prefix.
  await page.getByRole("button", { name: /^All Songs/ }).click();
  await waitForLibraryRows(page);
}

/** Wait until the TrackTable renders at least one row ([role="row"]). */
export async function waitForLibraryRows(
  page: Page,
  timeoutMs = 60_000,
): Promise<void> {
  await page.waitForSelector('[role="row"]', { timeout: timeoutMs });
  console.log(`${TAG} library rows rendered.`);
}

// ── Rendering scenarios (§4.6) ──────────────────────────────────────────────

/**
 * render.library-list (§4.6): scroll the virtualized TrackTable. Walks up from
 * the first [role="row"] to its scrollable ancestor (the table's own
 * overflow-y-auto container — NOT a bare selector, the sidebar scrolls too),
 * then sets scrollTop through the real DOM, firing the native scroll event the
 * table's bench listener marks on. The trailing settle gives the rAF frame
 * marks time to land before the app closes.
 */
export async function scrollLibraryList(page: Page): Promise<void> {
  console.log(`${TAG} scrolling the library list...`);
  const scrolled = await page.evaluate(() => {
    const row = document.querySelector('[role="row"]');
    let el = row?.parentElement ?? null;
    while (el) {
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
        return true;
      }
      el = el.parentElement;
    }
    return false;
  });
  if (!scrolled) {
    throw new DriverFailure(
      "scenario-step",
      "No scrollable library list found — rows rendered but the list does not overflow.",
    );
  }
  // The scroll handler marks one frame per rAF tick until scrollTop settles.
  await sleep(400);
}

/**
 * A real-title fragment for the search scenarios (design §4.3): the library
 * must be on screen (see openLibraryView), then the first rendered row's title
 * yields the longest ≥5-char word — a distinctive substring that matches at
 * least the source track, and is real benchmark data (§5, no synthetic
 * fixtures). Falls back to the first 5 chars for short/odd titles.
 */
export async function readRealTitleFragment(page: Page): Promise<string> {
  const title = await page.evaluate(() => {
    const row = document.querySelector('[role="row"]');
    const el = row?.querySelector(".truncate");
    return el ? (el.textContent ?? "").trim() : "";
  });
  if (!title) {
    throw new DriverFailure(
      "scenario-step",
      "No rendered track rows — could not read a real title fragment for search.",
    );
  }
  const words = title
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length >= 5);
  const fragment =
    words.sort((a, b) => b.length - a.length)[0] ??
    title.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").slice(0, 5);
  if (!fragment) {
    throw new DriverFailure(
      "scenario-step",
      `Could not derive a search fragment from title "${title}".`,
    );
  }
  console.log(`${TAG} search fragment "${fragment}" (from "${title}")`);
  return fragment;
}

/** Sidebar "Search" → the search view (home feed when the query is empty). */
export async function openSearchView(page: Page): Promise<void> {
  console.log(`${TAG} opening the search view...`);
  await page.getByRole("button", { name: /^Search/ }).click();
  await page.waitForSelector('input[type="text"]', { timeout: 30_000 });
}

const SOURCE_LABELS = ["All", "Local", "YT Music"] as const;

/** Read the currently active library-source label from the title-bar dropdown. */
async function readCurrentSourceLabel(page: Page): Promise<string | null> {
  return page.evaluate((labels) => {
    const header = document.querySelector("header");
    if (!header) return null;
    for (const btn of Array.from(header.querySelectorAll("button"))) {
      const text = (btn.textContent ?? "").trim();
      if (labels.includes(text)) {
        return text;
      }
    }
    return null;
  }, SOURCE_LABELS as readonly string[]);
}

/**
 * Switch the library source through the real title-bar dropdown (search.remote
 * needs source ≠ local for the remote search path, design §4.3).
 */
export async function switchLibrarySource(
  page: Page,
  target: "all" | "local" | "ytmusic",
): Promise<void> {
  const targetLabel =
    target === "ytmusic" ? "YT Music" : target === "all" ? "All" : "Local";
  const current = await readCurrentSourceLabel(page);
  if (!current) {
    throw new DriverFailure(
      "scenario-step",
      "Library source dropdown not found in the title bar.",
    );
  }
  if (current === targetLabel) {
    console.log(`${TAG} library source is already ${targetLabel}.`);
    return;
  }
  console.log(`${TAG} switching library source ${current} → ${targetLabel}...`);
  // Click the dropdown toggle (shows the current source), then the target item.
  await page.getByRole("button", { name: current, exact: true }).click();
  await page.getByRole("button", { name: targetLabel, exact: true }).click();
  // Let the store recompute playlists/tracks before the next step reads the UI.
  await sleep(500);
}

/**
 * Wait until the search outcome settles: the busy indicators are gone and the
 * results area (tracks, albums/playlists, or the zero-result message) rendered.
 * Mirrors the DOM state at which SearchView fires the search:results mark.
 * Scoped to <main> — the sidebar's "Albums"/"Playlists" labels never count.
 */
export async function waitForSearchSettled(
  page: Page,
  timeoutMs = 90_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const text = document.querySelector("main")?.textContent ?? "";
      const busy =
        text.includes("Updating results…") || text.includes("Searching...");
      if (busy) return false;
      return (
        text.includes("Songs (") ||
        text.includes("Albums") ||
        text.includes("Playlists") ||
        text.includes("No results")
      );
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * Type a query into the search box with real keystrokes and wait for the
 * results to settle (design §4.3: type → observe results). The trailing settle
 * gives the post-frame search:results mark time to land before app close.
 */
export async function typeSearch(page: Page, query: string): Promise<void> {
  console.log(`${TAG} typing search query "${query}"...`);
  const input = page.locator('input[type="text"]');
  await input.click();
  await page.keyboard.type(query, { delay: 25 });
  await waitForSearchSettled(page);
  await sleep(350);
}

// ── Playlist scenarios (§4.4) ────────────────────────────────────────────────

/** Sidebar "All Playlists" → the playlist grid (one button per playlist). */
export async function openPlaylistsView(
  page: Page,
  timeoutMs = 30_000,
): Promise<void> {
  console.log(`${TAG} opening the playlists view...`);
  await page.getByRole("button", { name: /^All Playlists/ }).click();
  await page.waitForSelector("main .grid > button", { timeout: timeoutMs });
}

/**
 * Playlist detail rendered: the YT hydration spinner is gone AND the track
 * area settled — either rows rendered, or the app's empty-list state ("No
 * tracks found"). The empty state matters for local playlists: their entries
 * resolve to zero library rows (entry ids `local:<path>` vs library track ids
 * `local:<hash>:<path>` — a known app mismatch flagged in #43). The trailing
 * settle gives the post-frame render mark time to land.
 */
async function waitForPlaylistDetail(
  page: Page,
  timeoutMs = 90_000,
): Promise<void> {
  await page.waitForFunction(
    () =>
      !(document.body?.innerText ?? "").includes(
        "Loading this YouTube Music playlist...",
      ),
    undefined,
    { timeout: timeoutMs },
  );
  await page.waitForFunction(
    () => {
      const text = document.querySelector("main")?.textContent ?? "";
      return (
        document.querySelectorAll('[role="row"]').length > 0 ||
        text.includes("No tracks found")
      );
    },
    undefined,
    { timeout: timeoutMs },
  );
  await sleep(400);
}

/**
 * Open a real LOCAL playlist through the UI (design §4.4): force the library
 * source to Local so the grid shows only local playlist files from the copied
 * profile, then open the first one and wait for its track list. Fails cleanly
 * when the copied profile has no local playlists (design §5.1 prerequisite).
 */
export async function openLocalPlaylist(page: Page): Promise<void> {
  console.log(`${TAG} opening a local playlist...`);
  await switchLibrarySource(page, "local");
  await openPlaylistsView(page);
  const gridItems = page.locator("main .grid > button");
  if ((await gridItems.count()) === 0) {
    throw new DriverFailure(
      "scenario-step",
      "No local playlists in the grid — the copied profile's playlists\\ is empty (design §5.1 prerequisite).",
    );
  }
  await gridItems.first().click();
  await waitForPlaylistDetail(page);
}

/**
 * Open a real YouTube Music playlist through the UI (design §4.4): force the
 * source to YT Music so the grid lists the remote playlists from the copied
 * session, open the first one, and wait through hydration until its track list
 * renders. The catalog's fixed playlistId stays the documented fallback
 * contract; per design §5 the driver opens a real playlist from the copied
 * session rather than hardcoding an id.
 */
export async function openYtPlaylist(page: Page): Promise<void> {
  console.log(`${TAG} opening a YouTube Music playlist...`);
  await switchLibrarySource(page, "ytmusic");
  await openPlaylistsView(page);
  const gridItems = page.locator("main .grid > button");
  if ((await gridItems.count()) === 0) {
    throw new DriverFailure(
      "scenario-step",
      "No YT Music playlists in the grid — the copied session has no remote playlists.",
    );
  }
  await gridItems.first().click();
  await waitForPlaylistDetail(page);
}

// ── Playback scenarios (§4.5) ────────────────────────────────────────────────

/** Click a track row (index within the current track table). */
export async function clickTrackRow(page: Page, index = 0): Promise<void> {
  console.log(`${TAG} clicking track row ${index}...`);
  const row = page.locator('[role="row"]').nth(index);
  await row.waitFor({ state: "visible", timeout: 60_000 });
  await row.click();
}

/**
 * Wait until a track is genuinely playing: the Pause button is shown
 * (isPlaying) AND the seek slider's aria-valuenow advanced past 0 (the first
 * timeupdate — which only fires after loadAndPlay's play() resolved, so the
 * useAudioEngine:loadAndPlay:playing mark/measure is already recorded).
 */
export async function waitForPlaying(
  page: Page,
  timeoutMs = 120_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const pause = Array.from(document.querySelectorAll("button")).some(
        (b) => b.getAttribute("aria-label") === "Pause",
      );
      const slider = document.querySelector('[role="slider"][aria-label="Seek"]');
      const now = slider ? Number(slider.getAttribute("aria-valuenow") ?? "0") : 0;
      return pause && now > 0;
    },
    undefined,
    { timeout: timeoutMs },
  );
  console.log(`${TAG} playback started (playing + first timeupdate).`);
}

/**
 * Click track rows 0..maxAttempts-1 until one actually starts playing. A single
 * dead row (stream resolution failure — yt-dlp hiccup, unavailable video, or
 * the known cache-layer defect) must not hard-fail the scenario: cache-dependent
 * flows are BEST-EFFORT (design §4.5). The scenario only fails when NO row
 * plays, which is a genuine environment failure (check yt-dlp + network).
 */
export async function clickPlayableTrack(
  page: Page,
  maxAttempts = 4,
  perAttemptMs = 45_000,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await clickTrackRow(page, attempt);
    try {
      await waitForPlaying(page, perAttemptMs);
      return;
    } catch {
      console.log(
        `${TAG} row ${attempt} did not start playing (stream resolution failed?) — trying the next row.`,
      );
    }
  }
  throw new DriverFailure(
    "scenario-step",
    `No playable track in the first ${maxAttempts} rows — stream resolution is failing (check yt-dlp + network).`,
  );
}

/** Click the PlayerBar "Next track" button (real UI advance). */
export async function clickNextTrack(page: Page): Promise<void> {
  console.log(`${TAG} clicking Next track...`);
  await page.getByRole("button", { name: "Next track" }).click();
}

/** Read the PlayerBar title + seek value (the current track's progress). */
async function readNowPlayingState(
  page: Page,
): Promise<{ title: string; value: number }> {
  return page.evaluate(() => {
    const footer = document.querySelector('footer[aria-label="Player controls"]');
    const titleEl = footer?.querySelector(".truncate");
    const slider = document.querySelector('[role="slider"][aria-label="Seek"]');
    return {
      title: titleEl ? (titleEl.textContent ?? "").trim() : "",
      value: slider ? Number(slider.getAttribute("aria-valuenow") ?? "0") : 0,
    };
  });
}

/**
 * Wait until a NEW track is playing: the PlayerBar title changed (auto-advance
 * or Next click) OR the seek value dropped back to ~0 (restart) while the
 * previous track had progressed past 2s. Either signal means the next
 * loadAndPlay ran, so its mark/measure pair is already recorded.
 */
export async function waitForTrackAdvance(
  page: Page,
  previousTitle: string,
  previousValue: number,
  timeoutMs = 120_000,
): Promise<void> {
  await page.waitForFunction(
    ({ prevTitle, prevValue }: { prevTitle: string; prevValue: number }) => {
      const footer = document.querySelector('footer[aria-label="Player controls"]');
      const titleEl = footer?.querySelector(".truncate");
      const title = titleEl ? (titleEl.textContent ?? "").trim() : "";
      const slider = document.querySelector('[role="slider"][aria-label="Seek"]');
      const now = slider ? Number(slider.getAttribute("aria-valuenow") ?? "0") : 0;
      const titleChanged = title.length > 0 && title !== prevTitle;
      const restarted = prevValue > 2 && now > 0 && now < prevValue - 2;
      return titleChanged || restarted;
    },
    { prevTitle: previousTitle, prevValue: previousValue },
    { timeout: timeoutMs },
  );
  console.log(`${TAG} advanced to the next track.`);
}

/**
 * Seek to ~98% of the current track through the real pointer path (the
 * Scrubber's pointerdown handler). The track then ends naturally a moment
 * later, driving the REAL onEnded → auto-advance path (playback.advance).
 */
export async function seekNearEnd(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const slider = document.querySelector('[role="slider"][aria-label="Seek"]');
      return slider ? Number(slider.getAttribute("aria-valuemax") ?? "0") > 0 : false;
    },
    undefined,
    { timeout: timeoutMs },
  );
  const slider = page.locator('[role="slider"][aria-label="Seek"]');
  const box = await slider.boundingBox();
  if (!box) {
    throw new DriverFailure("scenario-step", "Seek slider has no bounding box.");
  }
  await page.mouse.click(box.x + box.width * 0.98, box.y + box.height / 2);
  await sleep(250);
}

/**
 * playback.advance (§4.5): click a playable row (the view's list from that row
 * becomes the queue), then auto-advance through `trackCount` consecutive loads
 * by seeking each track near its end — the natural ended event drives onEnded →
 * playTrack(queue[n+1]), and every load re-emits the loadAndPlay mark/measure
 * pair. Ends when the last track is playing, so all consecutive measures are
 * recorded before the app closes.
 */
export async function driveQueueAdvance(
  page: Page,
  trackCount = 3,
): Promise<void> {
  console.log(`${TAG} driving auto-advance across ${trackCount} tracks...`);
  await clickPlayableTrack(page);
  const titles: string[] = [];
  for (let i = 0; i < trackCount; i++) {
    const state = await readNowPlayingState(page);
    titles.push(state.title);
    if (i === trackCount - 1) break; // last track: it just needs to be playing
    await seekNearEnd(page);
    await waitForTrackAdvance(page, state.title, state.value);
  }
  console.log(`${TAG} auto-advance titles: ${titles.join(" → ")}`);
}

/**
 * playback.preloader-hit (§4.5): play row 0 (the queue becomes the view's
 * list, and the preloader immediately prefetches stream URLs for the next
 * tracks), give the prefetch wave time to resolve, click Next through the real
 * UI, and wait for the new track playing. The prefetch mark/measure and the
 * auto-timed ytmusicGetPlayback IPC land before close; whether the advance is
 * actually a cache hit is best-effort (§4.5 caveat — never hard-asserted).
 */
export async function playTrackThenPrefetchAdvance(page: Page): Promise<void> {
  await clickPlayableTrack(page);
  const before = await readNowPlayingState(page);
  // Prefetch concurrency is 3 — let the first wave resolve so the Next click
  // is likely (not guaranteed) a preloader hit.
  await sleep(6_000);
  await clickNextTrack(page);
  await waitForTrackAdvance(page, before.title, before.value);
}
