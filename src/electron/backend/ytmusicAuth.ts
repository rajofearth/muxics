// YtAuthModule — auth state machine (login/logout/session import/status)
import fs from "node:fs";
import { Innertube } from "youtubei.js";
import type {
  AuthLoginCompleteResult,
  AuthLoginStartResult,
  AuthStatusResult,
  ImportYtMusicSessionResult,
  PendingYtMusicLoginResult,
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
} from "./ytmusicSession";
import { bumpYtMusicSearchCacheSession } from "./ytmusicSearchCache";
import { log } from "./logger";
import { YTMUSIC_CACHE_PATH } from "./paths";
import { classifyLibraryAuthState } from "./ytmusicParsing";

type PendingLoginState = {
  id: number;
  challenge: PendingYtMusicLoginResult;
  completion: Promise<AuthLoginCompleteResult>;
  canceled: boolean;
};

type ImportedSessionDetails = {
  cookieNames?: string[];
  sourceUrl?: string;
};

let cachedAuthStatus: AuthStatusResult | null = null;
let pendingLogin: PendingLoginState | null = null;

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
  } catch {
    return {
      profileName: "YouTube Music",
    };
  }
}

async function buildAuthStatus(): Promise<AuthStatusResult> {
  const lastSyncedAt = getCacheLastSyncedAt();
  let client: Innertube | null = getCachedClient();
  if (!client) {
    try {
      client = await getClient();
    } catch {
      client = null;
    }
  }

  if (!client) {
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent: false,
      lastSyncedAt,
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
      ...profile,
    };
  } catch (error) {
    setCachedClient(null);
    clearStoredYtMusicSession();
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent: false,
      lastSyncedAt,
      error:
        error instanceof Error
          ? error.message
          : "Failed to initialize YouTube Music session.",
    };
  }

  return cachedAuthStatus;
}

export async function validateCookieClient(cookie: string): Promise<Innertube> {
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

export async function loginToYtMusic(): Promise<AuthLoginStartResult> {
  return {
    kind: "error",
    message:
      "Automatic sign-in is unavailable for YouTube Music. Import your browser cookies instead.",
  };
}

export async function completeYtMusicLogin(): Promise<AuthLoginCompleteResult> {
  if (!pendingLogin) {
    const auth = await buildAuthStatus();
    return auth.loggedIn
      ? { kind: "completed", auth }
      : { kind: "error", message: "No YouTube Music sign-in is in progress." };
  }

  return pendingLogin.completion;
}

export function cancelYtMusicLogin(): { success: boolean } {
  if (!pendingLogin) {
    return { success: false };
  }

  pendingLogin.canceled = true;
  pendingLogin = null;
  setCachedClient(null);

  return { success: true };
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
  const normalizedCookie = normalizeCookieString(cookie);
  if (!normalizedCookie) {
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
    if (!persistCookieString(normalizedCookie)) {
      return {
        success: false,
        error:
          "Could not securely store the YouTube Music session on this machine.",
      };
    }

    pendingLogin = null;
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
  const normalizedCookie = normalizeCookieString(cookie);
  if (!normalizedCookie) {
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

  if (!persistCookieString(normalizedCookie)) {
    return {
      success: false,
      error:
        "Could not securely store the YouTube Music session on this machine.",
    };
  }

  pendingLogin = null;
  setCachedClient(null);
  cachedAuthStatus = null;
  resetLibraryAuthDebugFlag();
  bumpYtMusicSearchCacheSession();
  return { success: true };
}

export async function logoutFromYtMusic(): Promise<AuthStatusResult> {
  pendingLogin = null;
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
