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
  const allCookies = await chrome.cookies.getAll({});
  const filtered = allCookies.filter((c) => {
    const domain = c.domain.toLowerCase();
    if (domain.includes("youtube.com")) return true;

    // SAPISID/APISID may be scoped to Google rather than YouTube. Only
    // include the auth cookie names needed by the desktop session.
    return (
      domain.includes("google.com") && DIAGNOSTIC_COOKIE_NAMES.includes(c.name)
    );
  });

  if (!filtered.length) {
    throw new Error(
      "No YouTube Music cookies were found in this browser profile.",
    );
  }

  const cookieMap = new Map();
  const getPriority = (domain) => {
    if (domain === "music.youtube.com") return 4;
    if (domain === ".music.youtube.com") return 3;
    if (domain.includes("youtube.com")) return 2;
    if (domain.includes("google.com")) return 1;
    return 0;
  };

  filtered.sort((a, b) => getPriority(a.domain) - getPriority(b.domain));

  for (const c of filtered) {
    cookieMap.set(c.name, c.value);
  }

  const cookie = [...cookieMap.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  const cookieNames = DIAGNOSTIC_COOKIE_NAMES.filter((name) =>
    cookieMap.has(name),
  );

  const hasMusicCookie = filtered.some((c) => c.domain.includes("music.youtube.com"));
  const hasYoutubeCookie = filtered.some((c) => c.domain.includes("youtube.com"));

  return {
    cookie,
    cookieNames,
    sourceUrl: hasMusicCookie
      ? MUSIC_URL
      : hasYoutubeCookie
        ? YOUTUBE_URL
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
    return false; // App doesn't need a session right now
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
      return true;
    }
  } catch {
    // Silently retry on next alarm
  }
  return false;
}

// ── Alarm scheduling ──────────────────────────────────────────

let fastPollTimer = null;

function scheduleNormalRefresh() {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: REFRESH_INTERVAL_SECONDS / 60,
    periodInMinutes: REFRESH_INTERVAL_SECONDS / 60,
  });
}

// Chrome's alarms API has a 0.5-minute minimum interval, so the 10s
// recovery retry runs on a self-rescheduling timeout instead.
async function fastPollTick() {
  const accepted = await sendSessionToApp();
  if (accepted) return;
  // Keep retrying while the app still needs a session (or the bridge
  // is unreachable); stop once the app explicitly no longer needs one.
  const status = await bridgeFetch("/bridge/session-status");
  if (status === null || status?.needsRefresh) {
    fastPollTimer = setTimeout(fastPollTick, FAST_POLL_INTERVAL_SECONDS * 1000);
  }
}

function scheduleFastPoll() {
  clearTimeout(fastPollTimer);
  fastPollTimer = setTimeout(fastPollTick, FAST_POLL_INTERVAL_SECONDS * 1000);
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
      .then((accepted) => {
        if (accepted) clearTimeout(fastPollTimer);
        sendResponse({ accepted });
      })
      .catch(() => sendResponse({ accepted: false }));
    return true; // Keep channel open for async response
  }
});
