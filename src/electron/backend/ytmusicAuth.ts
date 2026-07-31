// YtAuthModule — auth state machine (login/logout/session import/status)
import fs from "node:fs";
import { Innertube } from "youtubei.js";
import type {
  AuthStatusResult,
  ImportYtMusicSessionResult,
} from "../../shared/desktop-contract";
import {
  getClient,
  getCachedClient,
  setCachedClient,
  resetLibraryAuthDebugFlag,
  createClientWithCookie,
  getCookiePresence,
  hasRequiredAuthCookie,
} from "./ytmusicClient";
import {
  clearStoredYtMusicSession,
  persistCookieString,
  loadStoredYtMusicSession,
} from "./ytmusicSession";
import { bumpYtMusicSearchCacheSession } from "./ytmusicSearchCache";
import { log } from "./logger";
import { YTMUSIC_CACHE_PATH } from "./paths";
import { classifyLibraryAuthState } from "./ytmusicParsing";
import {
  createYtMusicSessionCookie,
  serializeYtMusicSessionCookie,
  type YtMusicSessionCookie,
} from "./ytmusicCookie";

type ImportedSessionDetails = {
  cookieNames?: string[];
  sourceUrl?: string;
};

let cachedAuthStatus: AuthStatusResult | null = null;

function getCacheLastSyncedAt(): number | undefined {
  try {
    const raw = fs.readFileSync(YTMUSIC_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : undefined;
  } catch {
    return undefined;
  }
}

export async function getLibraryPageData(
  client: Innertube,
  filter?: string,
): Promise<any> {
  // Simple helper to fetch the library page context from Innertube.
  // Imported by ytmusicData.ts to do sync.
  if (!filter) {
    const response = await client.actions.execute("/browse", {
      browseId: "FEmusic_library_landing",
      client: "YTMUSIC",
    });
    return response.data;
  }

  // We need readText and collectRenderers, but wait, we can import them from ytmusicParsing or just do it.
  // Wait, let's import them to be clean, or we can just import readText/collectRenderers/readChipBrowseEndpoint from ytmusicParsing.
  const { collectRenderers, readText, readChipBrowseEndpoint } = await import("./ytmusicParsing");

  const base = await getLibraryPageData(client);
  const chipRenderers = collectRenderers(base, "chipCloudChipRenderer");
  const chip = chipRenderers.find((entry) => readText(entry.text) === filter);
  const endpoint = readChipBrowseEndpoint(chip);
  if (!endpoint) {
    return base;
  }

  const response = await client.actions.execute("/browse", {
    client: "YTMUSIC",
    ...(endpoint.browseId ? { browseId: endpoint.browseId } : {}),
    ...(endpoint.params ? { params: endpoint.params } : {}),
    ...(endpoint.continuation ? { continuation: endpoint.continuation } : {}),
  });
  return response.data;
}

async function resolveProfileName(
  client: Innertube,
): Promise<Pick<AuthStatusResult, "profileName" | "avatarUrl">> {
  try {
    const accounts = await client.account.getInfo(true);
    const selected =
      accounts.find((account) => account.is_selected) ?? accounts[0];

    return {
      profileName: selected?.account_name?.toString() ?? "YouTube Music",
      avatarUrl:
        selected?.account_photo?.[selected.account_photo.length - 1]?.url,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      msg.includes("fetch failed") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("EAI_AGAIN") ||
      msg.includes("ECONNRESET") ||
      msg.includes("socket hang up");

    if (isNetworkError) {
      return {
        profileName: "YouTube Music",
      };
    }
    throw error;
  }
}

async function buildAuthStatus(): Promise<AuthStatusResult> {
  const lastSyncedAt = getCacheLastSyncedAt();
  const stored = loadStoredYtMusicSession();
  const sessionUpdatedAt = stored?.updatedAt;

  let client: Innertube | null = getCachedClient();
  if (!client) {
    try {
      client = await getClient();
    } catch {
      client = null;
    }
  }

  if (!client || !client.session.logged_in) {
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent: false,
      lastSyncedAt,
      sessionUpdatedAt,
    };
    return cachedAuthStatus;
  }

  try {
    const profile = await resolveProfileName(client);
    cachedAuthStatus = {
      loggedIn: true,
      provider: "ytmusic",
      persistent: true,
      lastSyncedAt,
      sessionUpdatedAt,
      ...profile,
    };
  } catch (error) {
    setCachedClient(null);
    const message = error instanceof Error ? error.message : String(error);
    const isAuthFailure = /401|403|unauthor|sign in|expired/i.test(message);
    if (isAuthFailure) {
      clearStoredYtMusicSession();
    }
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent: false,
      lastSyncedAt,
      sessionUpdatedAt,
      error: message || "Failed to initialize YouTube Music session.",
    };
  }

  return cachedAuthStatus;
}

export async function validateCookieClient(
  cookie: YtMusicSessionCookie,
): Promise<Innertube> {
  const client = await createClientWithCookie(cookie);
  const libraryPage = await getLibraryPageData(client);
  const authState = classifyLibraryAuthState(libraryPage);

  if (!authState.authenticated) {
    throw new Error(authState.message);
  }

  return client;
}

export async function getYtMusicAuthStatus(): Promise<AuthStatusResult> {
  return buildAuthStatus();
}



function normalizeCookieString(cookie: string): string {
  return cookie
    .trim()
    .replace(/^cookie:\s*/i, "")
    .replace(/\r?\n/g, "; ")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("; ");
}

export async function importYtMusicSession(
  cookie: string,
  details?: ImportedSessionDetails,
): Promise<ImportYtMusicSessionResult> {
  const normalizedCookie = createYtMusicSessionCookie(
    normalizeCookieString(cookie),
  );
  if (!normalizedCookie.value) {
    return {
      success: false,
      error:
        "Paste a valid Cookie header from a logged-in music.youtube.com session.",
    };
  }

  const cookiePresence = getCookiePresence(normalizedCookie);
  const reportedCookieNames = details?.cookieNames ?? [];
  const hasImportedAuthCookie = hasRequiredAuthCookie(normalizedCookie);
  if (!hasImportedAuthCookie) {
    log(
      "ytmusic",
      "warn",
      "Rejected imported browser session without auth cookies",
      {
        sourceUrl: details?.sourceUrl ?? null,
        reportedCookieNames,
        cookiePresence,
      },
    );
    return {
      success: false,
      error:
        "The imported browser session is missing the YouTube Music auth cookies required for sign-in. Open music.youtube.com in the same browser profile, make sure you're logged in, and try again.",
    };
  }

  try {
    const client = await validateCookieClient(normalizedCookie);
    if (!persistCookieString(serializeYtMusicSessionCookie(normalizedCookie))) {
      return {
        success: false,
        error:
          "Could not securely store the YouTube Music session on this machine.",
      };
    }

    setCachedClient(client);
    resetLibraryAuthDebugFlag();
    bumpYtMusicSearchCacheSession();
    const auth = await buildAuthStatus();
    return {
      success: auth.loggedIn,
      auth,
      error: auth.loggedIn ? undefined : auth.error,
    };
  } catch (error) {
    setCachedClient(null);
    clearStoredYtMusicSession();
    resetLibraryAuthDebugFlag();
    log("ytmusic", "warn", "Imported browser session was rejected", {
      sourceUrl: details?.sourceUrl ?? null,
      reportedCookieNames,
      cookiePresence,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to validate the YouTube Music cookies.",
    };
  }
}

export function saveYtMusicCookieSession(
  cookie: string,
  details?: ImportedSessionDetails,
): { success: boolean; error?: string } {
  const normalizedCookie = createYtMusicSessionCookie(
    normalizeCookieString(cookie),
  );
  if (!normalizedCookie.value) {
    return {
      success: false,
      error:
        "Paste a valid Cookie header from a logged-in music.youtube.com session.",
    };
  }

  if (!hasRequiredAuthCookie(normalizedCookie)) {
    log("ytmusic", "warn", "Bridge sent browser session without auth cookies", {
      sourceUrl: details?.sourceUrl ?? null,
      reportedCookieNames: details?.cookieNames ?? [],
      cookiePresence: getCookiePresence(normalizedCookie),
    });
    return {
      success: false,
      error:
        "The imported browser session is missing the required YouTube Music auth cookies.",
    };
  }

  if (!persistCookieString(serializeYtMusicSessionCookie(normalizedCookie))) {
    return {
      success: false,
      error:
        "Could not securely store the YouTube Music session on this machine.",
    };
  }

  setCachedClient(null);
  cachedAuthStatus = null;
  resetLibraryAuthDebugFlag();
  bumpYtMusicSearchCacheSession();
  return { success: true };
}

export async function logoutFromYtMusic(): Promise<AuthStatusResult> {
  setCachedClient(null);
  resetLibraryAuthDebugFlag();
  bumpYtMusicSearchCacheSession();
  clearStoredYtMusicSession();
  cachedAuthStatus = {
    loggedIn: false,
    provider: "ytmusic",
    persistent: false,
    lastSyncedAt: getCacheLastSyncedAt(),
  };
  return cachedAuthStatus;
}
