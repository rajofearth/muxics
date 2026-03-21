import fs from "node:fs";
import type { OAuth2Tokens } from "youtubei.js";
import { safeStorage } from "electron";
import { YTMUSIC_SESSION_PATH, ensureAppDataDirs } from "./paths";
import { loadSettings } from "./settings";

export type StoredYtMusicAuth =
  | { kind: "cookie"; cookie: string }
  | { kind: "oauth"; oauth: OAuth2Tokens };

export interface StoredYtMusicSession {
  auth: StoredYtMusicAuth;
  createdAt: number;
  updatedAt: number;
}

type PersistedPayload = {
  encrypted: boolean;
  value: string;
  createdAt: number;
  updatedAt: number;
};

function isOAuthTokens(value: unknown): value is OAuth2Tokens {
  if (!value || typeof value !== "object") {
    return false;
  }

  const tokens = value as Partial<OAuth2Tokens>;
  return (
    typeof tokens.access_token === "string" &&
    typeof tokens.refresh_token === "string" &&
    typeof tokens.expiry_date === "string"
  );
}

function isStoredSession(value: unknown): value is StoredYtMusicSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<StoredYtMusicSession>;
  return (
    !!session.auth &&
    (
      ((session.auth as { kind?: string; cookie?: string }).kind === "cookie" &&
        typeof (session.auth as { cookie?: string }).cookie === "string") ||
      ((session.auth as { kind?: string; oauth?: OAuth2Tokens }).kind === "oauth" &&
        isOAuthTokens((session.auth as { oauth?: OAuth2Tokens }).oauth))
    ) &&
    typeof session.createdAt === "number" &&
    typeof session.updatedAt === "number"
  );
}

function encodeSession(payload: StoredYtMusicSession): PersistedPayload | null {
  const serialized = JSON.stringify(payload);

  if (safeStorage.isEncryptionAvailable()) {
    return {
      encrypted: true,
      value: safeStorage.encryptString(serialized).toString("base64"),
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  if (!loadSettings().allowPlaintextYtMusicSession) {
    return null;
  }

  return {
    encrypted: false,
    value: serialized,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

function decodeSession(payload: PersistedPayload): StoredYtMusicSession | null {
  try {
    const raw = payload.encrypted
      ? safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(payload.value, "base64"))
        : null
      : payload.value;

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    return isStoredSession(parsed) ? parsed : null;
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

export function persistOAuthTokens(tokens: OAuth2Tokens, createdAt?: number): boolean {
  const timestamp = Date.now();
  return saveStoredYtMusicSession({
    auth: { kind: "oauth", oauth: tokens },
    createdAt: createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

export function persistCookieString(cookie: string, createdAt?: number): boolean {
  const timestamp = Date.now();
  return saveStoredYtMusicSession({
    auth: { kind: "cookie", cookie },
    createdAt: createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

export function clearStoredYtMusicSession(): void {
  try {
    if (fs.existsSync(YTMUSIC_SESSION_PATH)) {
      fs.unlinkSync(YTMUSIC_SESSION_PATH);
    }
  } catch {}
}
