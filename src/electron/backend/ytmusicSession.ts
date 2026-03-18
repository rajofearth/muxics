import fs from "node:fs";
import { safeStorage, session as electronSession, type CookiesGetFilter } from "electron";
import { YTMUSIC_SESSION_PATH, ensureAppDataDirs } from "./paths";
import { loadSettings } from "./settings";

export const YTMUSIC_PARTITION = "persist:muxics-ytmusic";

export interface StoredYtMusicSession {
  cookie: string;
  createdAt: number;
}

type PersistedPayload = {
  encrypted: boolean;
  value: string;
  createdAt: number;
};

export function getYtMusicSession() {
  return electronSession.fromPartition(YTMUSIC_PARTITION, { cache: true });
}

function encodeSession(payload: StoredYtMusicSession): PersistedPayload | null {
  const serialized = JSON.stringify(payload);

  if (safeStorage.isEncryptionAvailable()) {
    return {
      encrypted: true,
      value: safeStorage.encryptString(serialized).toString("base64"),
      createdAt: payload.createdAt,
    };
  }

  if (!loadSettings().allowPlaintextYtMusicSession) {
    return null;
  }

  return {
    encrypted: false,
    value: serialized,
    createdAt: payload.createdAt,
  };
}

function decodeSession(payload: PersistedPayload): StoredYtMusicSession | null {
  try {
    if (payload.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }

      const decrypted = safeStorage.decryptString(Buffer.from(payload.value, "base64"));
      return JSON.parse(decrypted) as StoredYtMusicSession;
    }

    return JSON.parse(payload.value) as StoredYtMusicSession;
  } catch {
    return null;
  }
}

export function loadStoredYtMusicSession(): StoredYtMusicSession | null {
  ensureAppDataDirs();

  try {
    const raw = fs.readFileSync(YTMUSIC_SESSION_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistedPayload;
    return decodeSession(parsed);
  } catch {
    return null;
  }
}

export function saveStoredYtMusicSession(session: StoredYtMusicSession): boolean {
  ensureAppDataDirs();
  const payload = encodeSession(session);
  if (!payload) {
    return false;
  }

  fs.writeFileSync(YTMUSIC_SESSION_PATH, JSON.stringify(payload, null, 2), "utf-8");
  return true;
}

export function clearStoredYtMusicSession(): void {
  try {
    if (fs.existsSync(YTMUSIC_SESSION_PATH)) {
      fs.unlinkSync(YTMUSIC_SESSION_PATH);
    }
  } catch {}
}

async function getCookies(filter?: CookiesGetFilter) {
  return getYtMusicSession().cookies.get(filter);
}

export async function readYtMusicCookieString(): Promise<string> {
  const cookies = await getCookies({}) ;
  return cookies
    .filter((cookie) => cookie.domain.includes("youtube.com") || cookie.domain.includes("google.com"))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function restoreYtMusicSessionFromDisk(): Promise<boolean> {
  const stored = loadStoredYtMusicSession();
  if (!stored?.cookie) {
    return false;
  }

  const sess = getYtMusicSession();
  const pairs = stored.cookie
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      return {
        name: entry.slice(0, separator),
        value: entry.slice(separator + 1),
      };
    });

  for (const pair of pairs) {
    try {
      await sess.cookies.set({
        url: "https://music.youtube.com",
        name: pair.name,
        value: pair.value,
      });
    } catch {}
  }

  return true;
}

export async function persistCurrentYtMusicSession(): Promise<boolean> {
  const cookie = await readYtMusicCookieString();
  if (!cookie) {
    return false;
  }

  return saveStoredYtMusicSession({
    cookie,
    createdAt: Date.now(),
  });
}

export async function clearYtMusicCookies(): Promise<void> {
  const sess = getYtMusicSession();
  const cookies = await getCookies({});

  for (const cookie of cookies) {
    try {
      const protocol = cookie.secure ? "https" : "http";
      const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
      await sess.cookies.remove(`${protocol}://${host}${cookie.path}`, cookie.name);
    } catch {}
  }
}

export async function hasYtMusicAuthCookies(): Promise<boolean> {
  const cookies = await getCookies({});
  return cookies.some((cookie) =>
    ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID", "SID"].includes(cookie.name),
  );
}
