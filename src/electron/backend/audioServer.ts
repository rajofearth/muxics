import fs from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { log } from "./logger";
import { AUDIO_SERVER_PORT, MIME_TYPES } from "../../shared/constants";
import {
  createSapisidHash,
  getYtMusicSessionCookie,
} from "./ytmusicClient";
import { serializeYtMusicSessionCookie } from "./ytmusicCookie";
import {
  getYtMusicAuthStatus,
  importYtMusicSession,
} from "./ytmusicAuth";
import {
  ensureArtworkCached,
  getAudioPathByKey,
  getArtworkPathByKey,
  touchAudioEntry,
  warmAudioCache,
} from "./ytMusicCache";
import { APP_DATA_PATH } from "./paths";

let allowedPaths = new Set<string>();
let serverPort = 0;

function toComparablePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathAllowed(filePath: string): boolean {
  const resolved = toComparablePath(filePath);

  if (resolved.startsWith(toComparablePath(APP_DATA_PATH))) {
    return true;
  }

  for (const allowed of allowedPaths) {
    if (resolved.startsWith(allowed)) {
      return true;
    }
  }

  return false;
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function handlePlayback(req: IncomingMessage, res: ServerResponse): void {
  if (!req.url) {
    sendText(res, 400, "Missing URL");
    return;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/play") {
    sendText(res, 404, "Not Found");
    return;
  }

  const pathParam = url.searchParams.get("path");
  if (!pathParam) {
    sendText(res, 400, "Missing path");
    return;
  }

  let filePath: string;
  try {
    filePath = decodeURIComponent(pathParam);
  } catch {
    sendText(res, 400, "Invalid path");
    return;
  }

  if (!isPathAllowed(filePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendText(res, 404, "Not Found");
    return;
  }

  const contentType =
    MIME_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      sendText(res, 416, "Range Not Satisfiable");
      return;
    }

    const start = Number.parseInt(match[1], 10);
    const end = match[2]
      ? Math.min(Number.parseInt(match[2], 10), stat.size - 1)
      : stat.size - 1;

    if (start >= stat.size || end < start) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(stat.size),
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  });

  fs.createReadStream(filePath).pipe(res);
}

function streamLocalFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  contentType?: string | null,
): void {
  const stat = fs.statSync(filePath);
  const resolvedType =
    contentType ??
    MIME_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      sendText(res, 416, "Range Not Satisfiable");
      return;
    }

    const start = Number.parseInt(match[1], 10);
    const end = match[2]
      ? Math.min(Number.parseInt(match[2], 10), stat.size - 1)
      : stat.size - 1;

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= stat.size ||
      end < start ||
      end < 0
    ) {
      sendText(res, 416, "Range Not Satisfiable");
      return;
    }

    res.writeHead(206, {
      "Content-Type": resolvedType,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": resolvedType,
    "Content-Length": String(stat.size),
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  });

  fs.createReadStream(filePath).pipe(res);
}

async function handleYtCache(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!req.url) {
    return false;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/yt-cache/")) {
    return false;
  }

  const key = url.searchParams.get("key");
  const sourceUrl = url.searchParams.get("source");
  const trackId = url.searchParams.get("trackId");
  if (!key) {
    sendText(res, 400, "Missing key");
    return true;
  }

  if (url.pathname === "/yt-cache/artwork") {
    try {
      const cached = getArtworkPathByKey(key);
      const filePath =
        cached ??
        (sourceUrl ? await ensureArtworkCached(key, sourceUrl) : null);
      if (!filePath) {
        sendText(res, 404, "Artwork not found");
        return true;
      }

      streamLocalFile(req, res, filePath, null);
      return true;
    } catch {
      sendText(res, 500, "Artwork cache failed");
      return true;
    }
  }

  if (url.pathname === "/yt-cache/audio") {
    // ── Cache hit: serve directly from disk ──────────────────────
    {
      const cached = getAudioPathByKey(key);
      if (cached) {
        touchAudioEntry(key);
        streamLocalFile(req, res, cached, null);
        return true;
      }
    }

    if (!sourceUrl) {
      sendText(res, 404, "Audio not found");
      return true;
    }

    // ── Cache miss: proxy the upstream URL directly ─────────────
    // The upstream URL may be from yt-dlp (self-authenticating with PoT,
    // signature, expire params) or from old cached Innertube entries.
    // yt-dlp URLs don't need session cookies (they carry their own auth),
    // while old Innertube URLs may still need them.
    //
    // Strategy: try without cookies first, then with cookies if 403.
    const PROXY_TIMEOUT_MS = 20_000;

    async function tryProxy(withCookies: boolean): Promise<Response | null> {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
      try {
        if (!sourceUrl) return null;

        const sessionCookie = withCookies
          ? getYtMusicSessionCookie()
          : undefined;
        const authHeader =
          sessionCookie && withCookies
            ? createSapisidHash(sessionCookie)
            : undefined;

        const resp = await fetch(sourceUrl, {
          signal: ac.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            Accept: "*/*",
            Referer: "https://music.youtube.com",
            Origin: "https://music.youtube.com",
            ...(req.headers.range ? { Range: req.headers.range } : {}),
            ...(sessionCookie
              ? { Cookie: serializeYtMusicSessionCookie(sessionCookie) }
              : {}),
            ...(authHeader ? { Authorization: authHeader } : {}),
            "X-Goog-Authuser": "0",
          },
        });

        if (!resp.ok) {
          log(
            "audio-server",
            withCookies ? "warn" : "info",
            `Proxy attempt (cookies=${withCookies}) returned ${resp.status}`,
            { sourceUrl: sourceUrl?.slice(0, 80) },
          );
          return null;
        }

        return resp;
      } finally {
        clearTimeout(timeout);
      }
    }

    try {
      // 1. Try without session cookies first (yt-dlp URLs are self-auth)
      let upstream = await tryProxy(false);

      // 2. If 403, retry with session cookies (legacy Innertube URLs)
      if (!upstream) {
        upstream = await tryProxy(true);
      }

      if (!upstream) {
        // Both attempts failed — try warmAudioCache fallback
        log(
          "audio-server",
          "warn",
          "Proxy fetch failed both attempts, falling back to warmAudioCache",
          { sourceUrl: sourceUrl?.slice(0, 80) },
        );
        throw new Error("Proxy fetch failed (all attempts)");
      }

      const contentType = upstream.headers.get("content-type") || "audio/mp4";
      const contentRange = upstream.headers.get("content-range");
      const contentLength = upstream.headers.get("content-length");
      const acceptRanges = upstream.headers.get("accept-ranges");

      log("audio-server", "info", "Proxy stream started", {
        sourceUrl: sourceUrl?.slice(0, 80),
        contentType,
        status: upstream.status,
      });

      // Preserve the upstream response status and range metadata while adding CORS.
      const head: Record<string, string> = {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
      };
      if (contentRange) {
        head["Content-Range"] = contentRange;
      }
      if (contentLength) {
        head["Content-Length"] = contentLength;
      }
      if (acceptRanges) {
        head["Accept-Ranges"] = acceptRanges;
      }
      res.writeHead(upstream.status, head);

      const body = upstream.body;
      if (!body) {
        if (!res.headersSent) {
          sendText(res, 502, "Upstream returned empty body");
        }
        return true;
      }

      // Handle both Node.js Readable and web ReadableStream
      if (typeof (body as any).pipe === "function") {
        (body as any).on("error", () => {
          res.destroy();
        });
        (body as any).pipe(res);
      } else {
        Readable.fromWeb(body as any)
          .on("error", () => {
            res.destroy();
          })
          .pipe(res);
      }

      // Fire-and-forget background cache for next play
      warmAudioCache(key, sourceUrl, trackId || undefined).catch(() => {
        // Background cache failure is non-fatal
      });

      return true;
    } catch (err) {
      // Fallback: try the old warm-to-cache path
      try {
        await warmAudioCache(key, sourceUrl, trackId || undefined);

        const cached = getAudioPathByKey(key);
        if (cached) {
          touchAudioEntry(key);
          streamLocalFile(req, res, cached, null);
          return true;
        }

        sendText(res, 502, "Audio cache warm completed but file not found");
        return true;
      } catch (warmErr) {
        const msg =
          warmErr instanceof Error
            ? warmErr.message
            : "Audio cache warm failed";
        if (!res.headersSent) {
          sendText(res, 502, msg);
        }
        return true;
      }
    }
  }

  sendText(res, 404, "Not Found");
  return true;
}

const MAX_BODY_BYTES = 1_048_576;

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      req.destroy();
      throw new Error("Request body too large");
    }
    chunks.push(buf);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleBridge(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!req.url) {
    return false;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/bridge/")) {
    return false;
  }

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }

  if (url.pathname === "/bridge/ping" && req.method === "GET") {
    sendJson(res, 200, { success: true, app: "Muxics" });
    return true;
  }

  if (url.pathname === "/bridge/session-status" && req.method === "GET") {
    const auth = await getYtMusicAuthStatus();
    sendJson(res, 200, {
      success: true,
      needsRefresh: !auth.loggedIn,
      auth,
    });
    return true;
  }

  if (url.pathname === "/bridge/status" && req.method === "GET") {
    const auth = await getYtMusicAuthStatus();
    sendJson(res, 200, { success: true, auth });
    return true;
  }

  if (url.pathname === "/bridge/import-session" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await importYtMusicSession(body?.cookie ?? "", {
      cookieNames: Array.isArray(body?.cookieNames)
        ? body.cookieNames.filter(
            (entry: unknown): entry is string => typeof entry === "string",
          )
        : undefined,
      sourceUrl:
        typeof body?.sourceUrl === "string" ? body.sourceUrl : undefined,
    });
    sendJson(res, result.success ? 200 : 400, result);
    return true;
  }

  sendJson(res, 404, { success: false, error: "Bridge route not found." });
  return true;
}

export function setAllowedPaths(paths: string[]): void {
  allowedPaths = new Set(paths.map(toComparablePath));
}

export async function startAudioServer(): Promise<number> {
  if (serverPort > 0) {
    return serverPort;
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (await handleBridge(req, res)) {
          return;
        }
        if (await handleYtCache(req, res)) {
          return;
        }
        handlePlayback(req, res);
      } catch {
        sendText(res, 500, "Internal Server Error");
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(AUDIO_SERVER_PORT, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start audio server");
  }

  serverPort = address.port;
  return serverPort;
}

export function getAudioServerPort(): number {
  return serverPort;
}
