// Shared cookie utilities for the Muxics browser bridge.
// Loaded as a classic script in popup.html (before popup.js) and
// imported for side effects by the module service worker in
// background.js. Exposes `CookieUtils` on the global scope so both
// entry points share one implementation.

const DIAGNOSTIC_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PAPISID",
  "APISID",
  "SID",
  "HSID",
  "SSID",
];

function filterYoutubeCookies(allCookies) {
  return allCookies.filter((c) => {
    const domain = c.domain.toLowerCase();
    if (domain.includes("youtube.com")) return true;

    // SAPISID/APISID may be scoped to Google rather than YouTube. Only
    // include the auth cookie names needed by the desktop session.
    return (
      domain.includes("google.com") && DIAGNOSTIC_COOKIE_NAMES.includes(c.name)
    );
  });
}

// No explicit google.com case is needed: every cookie admitted by
// filterYoutubeCookies matches "youtube.com" or "google.com", so the
// google.com auth cookies sort ahead of youtube.com cookies either way.
function getPriority(domain) {
  if (domain === "music.youtube.com") return 4;
  if (domain === ".music.youtube.com") return 3;
  if (domain.includes("youtube.com")) return 2;
  return 0;
}

function sortAndBuildCookieMap(filtered) {
  filtered.sort((a, b) => getPriority(a.domain) - getPriority(b.domain));

  const cookieMap = new Map();
  for (const c of filtered) {
    cookieMap.set(c.name, c.value);
  }

  return cookieMap;
}

globalThis.CookieUtils = {
  DIAGNOSTIC_COOKIE_NAMES,
  filterYoutubeCookies,
  getPriority,
  sortAndBuildCookieMap,
};
