import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { MIME_TYPES } from "../../shared/constants";
import { getYtMusicAuthStatus, importYtMusicSession } from "./ytmusic";

let allowedPaths = new Set<string>();
let serverPort = 0;
const FIXED_SERVER_PORT = 46021;

function toComparablePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathAllowed(filePath: string): boolean {
  const resolved = toComparablePath(filePath);

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

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      sendText(res, 416, "Range Not Satisfiable");
      return;
    }

    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Math.min(Number.parseInt(match[2], 10), stat.size - 1) : stat.size - 1;

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

async function handleRemotePlayback(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!req.url) {
    return false;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/proxy") {
    return false;
  }

  const sourceUrl = url.searchParams.get("url");
  if (!sourceUrl) {
    sendText(res, 400, "Missing url");
    return true;
  }

  let parsedSource: URL;
  try {
    parsedSource = new URL(sourceUrl);
  } catch {
    sendText(res, 400, "Invalid url");
    return true;
  }

  if (parsedSource.protocol !== "https:") {
    sendText(res, 400, "Unsupported protocol");
    return true;
  }

  const upstream = await fetch(parsedSource, {
    headers: {
      ...(req.headers.range ? { Range: req.headers.range } : {}),
      "User-Agent":
        req.headers["user-agent"] ??
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      Accept: req.headers.accept ?? "*/*",
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
    sendText(res, upstream.status, `Upstream request failed (${upstream.status})`);
    return true;
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": upstream.headers.get("accept-ranges") ?? "bytes",
  };

  const contentType = upstream.headers.get("content-type");
  const contentLength = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");

  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  if (contentLength) {
    headers["Content-Length"] = contentLength;
  }
  if (contentRange) {
    headers["Content-Range"] = contentRange;
  }

  res.writeHead(upstream.status, headers);

  if (!upstream.body) {
    res.end();
    return true;
  }

  Readable.fromWeb(upstream.body as globalThis.ReadableStream<Uint8Array>).pipe(res);
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleBridge(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
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

  if (url.pathname === "/bridge/status" && req.method === "GET") {
    const auth = await getYtMusicAuthStatus();
    sendJson(res, 200, { success: true, auth });
    return true;
  }

  if (url.pathname === "/bridge/import-session" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await importYtMusicSession(body?.cookie ?? "", {
      cookieNames: Array.isArray(body?.cookieNames)
        ? body.cookieNames.filter((entry: unknown): entry is string => typeof entry === "string")
        : undefined,
      sourceUrl: typeof body?.sourceUrl === "string" ? body.sourceUrl : undefined,
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
        if (await handleRemotePlayback(req, res)) {
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
    server.listen(FIXED_SERVER_PORT, "127.0.0.1", () => resolve());
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
