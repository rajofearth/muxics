import path from "path";
import { MIME_TYPES } from "../shared/constants";

let allowedPaths: Set<string> = new Set();
let serverPort = 0;

function normalizeForCompare(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function setAllowedPaths(paths: string[]): void {
  allowedPaths = new Set(paths.map((targetPath) => normalizeForCompare(targetPath)));
}

function isPathAllowed(filePath: string): boolean {
  const resolved = normalizeForCompare(filePath);
  for (const allowed of allowedPaths) {
    const relative = path.relative(allowed, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return true;
    }
  }
  return false;
}

export async function startAudioServer(): Promise<number> {
  if (serverPort > 0) return serverPort;

  const server = Bun.serve({
    port: 38473 + Math.floor(Math.random() * 10778),
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/play") {
        return new Response("Not Found", { status: 404 });
      }

      const pathParam = url.searchParams.get("path");
      if (!pathParam) {
        return new Response("Missing path", { status: 400 });
      }

      let filePath: string;
      try {
        filePath = decodeURIComponent(pathParam);
      } catch {
        return new Response("Invalid path", { status: 400 });
      }

      if (!isPathAllowed(filePath)) {
        return new Response("Forbidden", { status: 403 });
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      try {
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
          return new Response("Not Found", { status: 404 });
        }

        const size = file.size;
        const rangeHeader = req.headers.get("Range");

        // ── Handle Range requests (required for seeking) ──────────────
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;

            if (start >= size || end < start) {
              return new Response("Range Not Satisfiable", {
                status: 416,
                headers: { "Content-Range": `bytes */${size}` },
              });
            }

            const chunkSize = end - start + 1;

            return new Response(file.slice(start, end + 1), {
              status: 206,
              headers: {
                "Content-Type": contentType,
                "Content-Range": `bytes ${start}-${end}/${size}`,
                "Content-Length": String(chunkSize),
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
        }

        // ── Full response (no Range header) ──────────────────────────
        return new Response(file.stream(), {
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(size),
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch {
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });

  serverPort = server.port ?? 0;
  return serverPort;
}

export function getAudioServerPort(): number {
  return serverPort;
}
