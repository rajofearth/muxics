// Scenario UI steps (issue #42) — real clicks/keyboard on the actual DOM,
// per the design's automation-fidelity lock (§4): the bridge is used only for
// state assertions; every flow with a UI surface is driven through the UI.
//
// These are the post-readiness steps the runner passes into runLaunchCycle for
// the library and search scenarios. Each step ends only when the DOM shows the
// outcome it was driving toward, so the marks/measures/IPCs the step produces
// are guaranteed to be recorded before the app closes.
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
    for (const btn of header.querySelectorAll("button")) {
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
