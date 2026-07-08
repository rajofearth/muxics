const BRIDGE_URL = "http://127.0.0.1:46021";
const MUSIC_URL = "https://music.youtube.com/";
const YOUTUBE_URL = "https://www.youtube.com/";
const ROOT_YOUTUBE_URL = "https://youtube.com/";
const GOOGLE_URL = "https://accounts.google.com/";
const ALARM_NAME = "refreshSession";
/** Normal interval between background refreshes (seconds). */
const REFRESH_INTERVAL_SECONDS = 30;
/** Fast retry interval when the app needs a session (seconds). */
const FAST_POLL_INTERVAL_SECONDS = 10;
/** Delay before the first alarm fires after install (seconds). */
const INITIAL_DELAY_SECONDS = 5;
const DIAGNOSTIC_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PAPISID",
  "APISID",
  "SID",
  "HSID",
  "SSID",
];

// ── Cookie helpers (shared pattern with popup.js) ──────────────

function mergeCookieSets(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const cookie of group) {
      merged.set(cookie.name, cookie.value);
    }
  }
  return merged;
}

async function getCookiePayload() {
  const [musicCookies, youtubeCookies, rootYoutubeCookies, googleCookies] =
    await Promise.all([
      chrome.cookies.getAll({ url: MUSIC_URL }),
      chrome.cookies.getAll({ url: YOUTUBE_URL }),
      chrome.cookies.getAll({ url: ROOT_YOUTUBE_URL }),
      chrome.cookies.getAll({ url: GOOGLE_URL }),
    ]);

  const cookieMap = mergeCookieSets(
    googleCookies,
    rootYoutubeCookies,
    youtubeCookies,
    musicCookies,
  );
  if (!cookieMap.size) {
    throw new Error(
      "No YouTube Music cookies were found in this browser profile.",
    );
  }

  const cookie = [...cookieMap.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  const cookieNames = DIAGNOSTIC_COOKIE_NAMES.filter((name) =>
    cookieMap.has(name),
  );

  return {
    cookie,
    cookieNames,
    sourceUrl:
      musicCookies.length > 0
        ? MUSIC_URL
        : youtubeCookies.length > 0
          ? YOUTUBE_URL
          : rootYoutubeCookies.length > 0
            ? ROOT_YOUTUBE_URL
            : GOOGLE_URL,
  };
}

// ── Bridge helpers ────────────────────────────────────────────

async function bridgeFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function sendSessionToApp() {
  // Check if the app is running and needs a refresh
  const status = await bridgeFetch("/bridge/session-status");
  if (!status?.needsRefresh) {
    return; // App doesn't need a session right now
  }

  try {
    const payload = await getCookiePayload();
    const result = await bridgeFetch("/bridge/import-session", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (result?.success) {
      // Session was accepted — switch to normal polling
      scheduleNormalRefresh();
    }
  } catch {
    // Silently retry on next alarm
  }
}

// ── Alarm scheduling ──────────────────────────────────────────

function scheduleNormalRefresh() {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: REFRESH_INTERVAL_SECONDS / 60,
    periodInMinutes: REFRESH_INTERVAL_SECONDS / 60,
  });
}

function scheduleFastPoll() {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: FAST_POLL_INTERVAL_SECONDS / 60,
    periodInMinutes: FAST_POLL_INTERVAL_SECONDS / 60,
  });
}

// ── Lifecycle ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Fire the first attempt after a short delay, then settle into normal refresh
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: INITIAL_DELAY_SECONDS / 60,
    periodInMinutes: REFRESH_INTERVAL_SECONDS / 60,
  });
});

// Listen for the alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void sendSessionToApp();
  }
});

// Respond to messages from the popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "app_needs_session") {
    // App needs a session immediately — switch to fast polling
    scheduleFastPoll();
    // Trigger an immediate attempt
    sendSessionToApp()
      .then(() => sendResponse({ accepted: true }))
      .catch(() => sendResponse({ accepted: false }));
    return true; // Keep channel open for async response
  }
});
