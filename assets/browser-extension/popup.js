const statusEl = document.getElementById("status");
const connectButton = document.getElementById("connect");
const openMusicButton = document.getElementById("open-music");
const BASE_URL = "http://127.0.0.1:46021";
const MUSIC_URL = "https://music.youtube.com/";
const YOUTUBE_URL = "https://www.youtube.com/";
const ROOT_YOUTUBE_URL = "https://youtube.com/";
const GOOGLE_URL = "https://accounts.google.com/";
const DIAGNOSTIC_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PAPISID",
  "APISID",
  "SID",
  "HSID",
  "SSID",
];

function setStatus(message, tone = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status ${tone}`.trim();
}

function mergeCookieSets(...groups) {
  const merged = new Map();

  for (const group of groups) {
    for (const cookie of group) {
      merged.set(cookie.name, cookie.value);
    }
  }

  return merged;
}

function summarizeCookiePresence(cookieMap) {
  return DIAGNOSTIC_COOKIE_NAMES.filter((name) => cookieMap.has(name));
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
    throw new Error("No YouTube Music cookies were found in this browser profile.");
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
  const cookieNames = summarizeCookiePresence(cookieMap);

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

async function callBridge(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Muxics bridge request failed.");
    }

    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Muxics did not respond. Make sure the desktop app is running.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

connectButton?.addEventListener("click", async () => {
  connectButton.disabled = true;
  setStatus("Collecting browser session...");

  try {
    setStatus("Checking Muxics bridge...");
    await callBridge("/bridge/ping");
    const payload = await getCookiePayload();
    setStatus("Sending session to Muxics...");
    const response = await callBridge("/bridge/import-session", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response?.success) {
      throw new Error(response?.error || "The desktop app rejected the session.");
    }

    setStatus("Session sent successfully. Return to Muxics.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not connect to Muxics.", "error");
  } finally {
    connectButton.disabled = false;
  }
});

openMusicButton?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://music.youtube.com" });
});
