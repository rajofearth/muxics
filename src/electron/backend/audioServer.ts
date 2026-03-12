import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { MIME_TYPES } from "../../shared/constants";

let allowedPaths = new Set<string>();
let serverPort = 0;

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
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
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

export function setAllowedPaths(paths: string[]): void {
  allowedPaths = new Set(paths.map(toComparablePath));
}

export async function startAudioServer(): Promise<number> {
  if (serverPort > 0) {
    return serverPort;
  }

  const server = createServer((req, res) => {
    try {
      handlePlayback(req, res);
    } catch {
      sendText(res, 500, "Internal Server Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
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
