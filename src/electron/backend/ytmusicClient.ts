import crypto from "node:crypto";
import { Innertube } from "youtubei.js";
import { log } from "./logger";
import {
  clearStoredYtMusicSession,
  loadStoredYtMusicSession,
  persistOAuthTokens,
} from "./ytmusicSession";

let cachedClient: Innertube | null = null;
let cachedClientSessionUpdatedAt: number | null = null;
let loggedLibraryAuthDebug = false;

const YTMUSIC_ORIGIN = "https://music.youtube.com";
const YTMUSIC_CLIENT_NAME = "WEB_REMIX";
const YTMUSIC_CLIENT_ID = "67";
const REQUIRED_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PAPISID",
  "APISID",
] as const;
const DIAGNOSTIC_COOKIE_NAMES = [
  ...REQUIRED_COOKIE_NAMES,
  "SID",
  "HSID",
  "SSID",
] as const;

function getCookieValue(
  cookie: string | undefined,
  name: string,
): string | undefined {
  if (!cookie) {
    return undefined;
  }

  const part = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  return part ? part.slice(name.length + 1) : undefined;
}

export function createSapisdHash(cookie: string): string | null {
  const sid =
    getCookieValue(cookie, "SAPISID") ||
    getCookieValue(cookie, "__Secure-3PAPISID") ||
    getCookieValue(cookie, "__Secure-1PAPISID") ||
    getCookieValue(cookie, "APISID");

  if (!sid) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const hash = crypto
    .createHash("sha1")
    .update(`${timestamp} ${sid} ${YTMUSIC_ORIGIN}`, "utf8")
    .digest("hex");

  return `SAPISIDHASH ${timestamp}_${hash}`;
}

export function getCookiePresence(
  cookie: string | undefined,
): Record<string, boolean> {
  return Object.fromEntries(
    DIAGNOSTIC_COOKIE_NAMES.map((name) => [
      name,
      Boolean(getCookieValue(cookie, name)),
    ]),
  );
}

export function hasRequiredAuthCookie(cookie: string | undefined): boolean {
  return REQUIRED_COOKIE_NAMES.some((name) =>
    Boolean(getCookieValue(cookie, name)),
  );
}

function getYtMusicRequestContext(headers: Headers, body?: string) {
  const clientId = headers.get("X-Youtube-Client-Name") ?? "";
  let clientName = "";
  let browseId = "";

  if (body) {
    try {
      const parsed = JSON.parse(body) as {
        context?: { client?: { clientName?: string } };
        browseId?: string;
      };
      clientName = parsed.context?.client?.clientName ?? "";
      browseId = parsed.browseId ?? "";
    } catch {}
  }

  return {
    clientId,
    clientName,
    browseId,
    isYtMusicRequest:
      clientId === YTMUSIC_CLIENT_ID || clientName === YTMUSIC_CLIENT_NAME,
  };
}

function createFetchWithYtMusicAuth(cookie?: string): typeof fetch | undefined {
  if (!cookie) {
    return undefined;
  }

  return async (input, init) => {
    const originalUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const body = typeof init?.body === "string" ? init.body : undefined;
    const requestContext = getYtMusicRequestContext(headers, body);
    const isYtMusicRequest =
      originalUrl.includes("/youtubei/v1/") &&
      (requestContext.isYtMusicRequest ||
        originalUrl.includes("/like/") ||
        originalUrl.includes("/playlist/edit") ||
        requestContext.browseId?.startsWith("FEmusic_"));
    const isLibraryBrowse =
      requestContext.browseId === "FEmusic_library_landing";
    let authorizationApplied = false;
    let requestUrl = originalUrl;

    if (isYtMusicRequest) {
      const rewrittenUrl = new URL(originalUrl);
      if (rewrittenUrl.hostname === "www.youtube.com") {
        rewrittenUrl.hostname = "music.youtube.com";
        requestUrl = rewrittenUrl.toString();
      }

      headers.set("Origin", YTMUSIC_ORIGIN);
      headers.set("Referer", `${YTMUSIC_ORIGIN}/`);
      headers.set("X-Origin", YTMUSIC_ORIGIN);
      headers.set("Cookie", cookie);
      headers.set("X-Goog-Authuser", headers.get("X-Goog-Authuser") ?? "0");

      const authHeader = createSapisdHash(cookie);
      if (authHeader) {
        headers.set("Authorization", authHeader);
        authorizationApplied = true;
      }
    }

    if (isLibraryBrowse && !loggedLibraryAuthDebug) {
      loggedLibraryAuthDebug = true;
      log("ytmusic", "info", "Applying YT Music request auth", {
        clientId: requestContext.clientId || null,
        clientName: requestContext.clientName || null,
        browseId: requestContext.browseId,
        overrideApplied: isYtMusicRequest,
        authorizationApplied,
        originalUrl,
        requestUrl,
        cookiePresence: getCookiePresence(cookie),
      });
    }

    const baseInit =
      input instanceof Request
        ? {
            method: input.method,
            redirect: input.redirect,
            duplex:
              "duplex" in input
                ? (input as Request & { duplex?: "half" }).duplex
                : undefined,
          }
        : {};

    return fetch(requestUrl, {
      ...baseInit,
      ...init,
      body: body ?? init?.body,
      headers,
    });
  };
}

async function createClient(cookie?: string): Promise<Innertube> {
  loggedLibraryAuthDebug = false;

  const client = await Innertube.create({
    cookie,
    fetch: createFetchWithYtMusicAuth(cookie),
    retrieve_player: true,
    generate_session_locally: true,
  });

  return client;
}

export async function createClientWithCookie(cookie: string): Promise<Innertube> {
  return createClient(cookie);
}

function attachCredentialPersistence(
  client: Innertube,
  createdAt?: number,
): void {
  client.session.on("auth", ({ credentials }) => {
    persistOAuthTokens(credentials, createdAt);
  });

  client.session.on("update-credentials", ({ credentials }) => {
    persistOAuthTokens(credentials, createdAt);
  });
}

async function restoreClientFromDisk(): Promise<Innertube | null> {
  const stored = loadStoredYtMusicSession();
  if (!stored?.auth) {
    clearStoredYtMusicSession();
    cachedClientSessionUpdatedAt = null;
    return null;
  }

  try {
    if (stored.auth.kind === "cookie") {
      const client = await createClient(stored.auth.cookie);
      cachedClient = client;
      cachedClientSessionUpdatedAt = stored.updatedAt;
      return client;
    }

    const client = await createClient();
    attachCredentialPersistence(client, stored.createdAt);
    await client.session.signIn(stored.auth.oauth);
    cachedClient = client;
    cachedClientSessionUpdatedAt = stored.updatedAt;
    return client;
  } catch (error) {
    log("ytmusic", "warn", "Failed to restore OAuth session", error);
    clearStoredYtMusicSession();
    cachedClient = null;
    cachedClientSessionUpdatedAt = null;
    return null;
  }
}

export async function getClient(force = false): Promise<Innertube> {
  const stored = loadStoredYtMusicSession();
  const diskUpdatedAt = stored?.updatedAt ?? null;

  if (
    cachedClient &&
    !force &&
    cachedClientSessionUpdatedAt === diskUpdatedAt
  ) {
    return cachedClient;
  }

  const restored = await restoreClientFromDisk();
  if (!restored) {
    throw new Error("No YouTube Music session is available.");
  }

  return restored;
}

/**
 * Returns the YouTube Music session cookie from the cached Innertube client.
 * Used by the audio server proxy and cache warm paths to pass auth context
 * to googlevideo CDN requests that would otherwise return 403.
 */
export function getYtMusicSessionCookie(): string | undefined {
  return cachedClient?.session.cookie;
}

export function setCachedClient(client: Innertube | null): void {
  cachedClient = client;
  if (!client) {
    cachedClientSessionUpdatedAt = null;
  }
}

export function getCachedClient(): Innertube | null {
  return cachedClient;
}

export function resetLibraryAuthDebugFlag(): void {
  loggedLibraryAuthDebug = false;
}
