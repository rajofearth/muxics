import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import type { TrackResult } from "../../shared/desktop-contract";
import { log } from "./logger";
import { YTMUSIC_TOOLS_DIR, ensureAppDataDirs } from "./paths";

export type ResolvedPlayback = {
  url: string;
  expiresAt?: number;
  formatId?: string;
  source: "yt-dlp";
};

export type ResolvedTrack = Pick<
  TrackResult,
  "providerId" | "title" | "artist" | "album" | "duration" | "picture" | "time"
>;

export type ResolvedPlaylist = {
  providerId: string;
  name: string;
  tracks: ResolvedTrack[];
};

type YtDlpCommand = {
  executable: string;
  argsPrefix: string[];
  strategy: "bundled" | "cached" | "python";
};

type JsonLike = Record<string, any>;

const COOKIE_FILE_HEADER = "# Netscape HTTP Cookie File";
const DOWNLOAD_URLS: Partial<Record<NodeJS.Platform, string>> = {
  win32: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  linux: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
  darwin: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
};
const VERSION_REFRESH_MS = 1000 * 60 * 60 * 24 * 7;

let cachedCommandInfo: { command: YtDlpCommand; version: string } | null = null;
let pendingCommandInfo: Promise<{ command: YtDlpCommand; version: string }> | null = null;

function getExecutableName(): string {
  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

function getBundledExecutablePath(): string {
  if (process.resourcesPath && !process.defaultApp) {
    return path.join(process.resourcesPath, "yt-dlp", getExecutableName());
  }

  return path.resolve(process.cwd(), "assets", "vendor", "yt-dlp", getExecutableName());
}

function getCachedExecutablePath(): string {
  return path.join(YTMUSIC_TOOLS_DIR, getExecutableName());
}

function normalizeDuration(seconds?: number): { duration: number; time: string } {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return {
    duration: total,
    time: `${minutes}:${remainder.toString().padStart(2, "0")}`,
  };
}

function parseCommandOutput(stdout: string): JsonLike {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("yt-dlp returned an empty response.");
  }

  return JSON.parse(trimmed) as JsonLike;
}

function parseFirstOutputLine(stdout: string): string {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    throw new Error("yt-dlp returned an empty response.");
  }

  return line;
}

function buildYouTubeUrl(id: string, kind: "video" | "playlist"): string {
  return kind === "playlist"
    ? `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`
    : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

function buildYtMusicUrl(id: string, kind: "video" | "playlist"): string {
  return kind === "playlist"
    ? `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`
    : `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

async function runProcess(
  executable: string,
  args: string[],
  timeoutMs = 120000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (timedOut) {
        reject(new Error("yt-dlp timed out."));
        return;
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `yt-dlp exited with code ${code}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function getVersion(command: YtDlpCommand): Promise<string> {
  const result = await runProcess(command.executable, [...command.argsPrefix, "--version"], 30000);
  return result.stdout.trim() || "unknown";
}

async function commandWorks(command: YtDlpCommand): Promise<string | null> {
  try {
    return await getVersion(command);
  } catch {
    return null;
  }
}

async function ensureCachedExecutable(): Promise<string | null> {
  ensureAppDataDirs();
  const executablePath = getCachedExecutablePath();

  try {
    const stat = fs.existsSync(executablePath) ? fs.statSync(executablePath) : null;
    const ageMs = stat ? Date.now() - stat.mtimeMs : Number.POSITIVE_INFINITY;

    if (stat && ageMs < VERSION_REFRESH_MS) {
      return executablePath;
    }
  } catch {}

  const downloadUrl = DOWNLOAD_URLS[process.platform];
  if (!downloadUrl) {
    return fs.existsSync(executablePath) ? executablePath : null;
  }

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const tempPath = `${executablePath}.tmp`;
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
    if (process.platform !== "win32") {
      fs.chmodSync(tempPath, 0o755);
    }
    fs.renameSync(tempPath, executablePath);
    log("ytmusic", "info", "Downloaded yt-dlp binary", {
      target: executablePath,
      source: downloadUrl,
    });
    return executablePath;
  } catch (error) {
    if (fs.existsSync(executablePath)) {
      return executablePath;
    }

    log("ytmusic", "warn", "Failed to download yt-dlp binary", {
      source: downloadUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveCommandInternal(): Promise<{ command: YtDlpCommand; version: string }> {
  const bundledCommand: YtDlpCommand = {
    executable: getBundledExecutablePath(),
    argsPrefix: [],
    strategy: "bundled",
  };

  if (fs.existsSync(bundledCommand.executable)) {
    const version = await commandWorks(bundledCommand);
    if (version) {
      return { command: bundledCommand, version };
    }
  }

  const cachedExecutable = await ensureCachedExecutable();
  if (cachedExecutable) {
    const cachedCommand: YtDlpCommand = {
      executable: cachedExecutable,
      argsPrefix: [],
      strategy: "cached",
    };
    const version = await commandWorks(cachedCommand);
    if (version) {
      return { command: cachedCommand, version };
    }
  }

  for (const executable of ["python", "py"]) {
    const pythonCommand: YtDlpCommand = {
      executable,
      argsPrefix: executable === "py" ? ["-m", "yt_dlp"] : ["-m", "yt_dlp"],
      strategy: "python",
    };
    const version = await commandWorks(pythonCommand);
    if (version) {
      return { command: pythonCommand, version };
    }
  }

  throw new Error(
    "No working yt-dlp resolver was found. Add a bundled yt-dlp binary, allow the app to download one, or install yt-dlp for your system Python.",
  );
}

async function resolveCommand(): Promise<{ command: YtDlpCommand; version: string }> {
  if (cachedCommandInfo) {
    return cachedCommandInfo;
  }

  if (!pendingCommandInfo) {
    pendingCommandInfo = resolveCommandInternal()
      .then((result) => {
        cachedCommandInfo = result;
        log("ytmusic", "info", "Using yt-dlp resolver", {
          strategy: result.command.strategy,
          executable: result.command.executable,
          version: result.version,
        });
        return result;
      })
      .finally(() => {
        pendingCommandInfo = null;
      });
  }

  return pendingCommandInfo;
}

function escapeCookieValue(value: string): string {
  return value.replace(/\t/g, "%09").replace(/\r?\n/g, "");
}

function buildCookieFile(cookieHeader?: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const lines = [COOKIE_FILE_HEADER];
  const cookies = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    lines.push([ ".youtube.com", "TRUE", "/", "TRUE", "0", name, escapeCookieValue(value) ].join("\t"));
  }

  if (lines.length === 1) {
    return null;
  }

  const filePath = path.join(
    os.tmpdir(),
    `muxics-ytmusic-cookies-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

function cleanupTempFile(filePath: string | null): void {
  if (!filePath) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function buildBaseArgs(cookieFilePath: string | null): string[] {
  const args = ["--skip-download"];

  if (cookieFilePath) {
    args.push("--cookies", cookieFilePath);
  }

  return args;
}

async function runJsonQuery(
  url: string,
  cookieHeader?: string,
  extraArgs: string[] = [],
): Promise<JsonLike> {
  const { command } = await resolveCommand();
  const cookieFilePath = buildCookieFile(cookieHeader);

  try {
    const { stdout } = await runProcess(command.executable, [
      ...command.argsPrefix,
      "--dump-single-json",
      ...buildBaseArgs(cookieFilePath),
      ...extraArgs,
      url,
    ]);
    return parseCommandOutput(stdout);
  } finally {
    cleanupTempFile(cookieFilePath);
  }
}

async function runTextQuery(
  url: string,
  cookieHeader?: string,
  extraArgs: string[] = [],
): Promise<string> {
  const { command } = await resolveCommand();
  const cookieFilePath = buildCookieFile(cookieHeader);

  try {
    const { stdout } = await runProcess(command.executable, [
      ...command.argsPrefix,
      ...buildBaseArgs(cookieFilePath),
      ...extraArgs,
      url,
    ]);
    return parseFirstOutputLine(stdout);
  } finally {
    cleanupTempFile(cookieFilePath);
  }
}

function pickString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickThumbnail(entry: JsonLike): string | undefined {
  const thumbnails = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  const last = thumbnails[thumbnails.length - 1];
  return pickString(last?.url, entry.thumbnail, entry.artwork_url);
}

function normalizeTrack(entry: JsonLike): ResolvedTrack | null {
  const providerId = pickString(entry.id, entry.url?.split("v=")[1]);
  if (!providerId) {
    return null;
  }

  const seconds =
    typeof entry.duration === "number"
      ? entry.duration
      : typeof entry.duration_seconds === "number"
        ? entry.duration_seconds
        : undefined;
  const { duration, time } = normalizeDuration(seconds);

  return {
    providerId,
    title: pickString(entry.track, entry.title) ?? "Unknown Track",
    artist: pickString(entry.artist, entry.uploader, entry.channel, entry.creator) ?? "Unknown Artist",
    album: pickString(entry.album) ?? "Single",
    duration,
    time,
    picture: pickThumbnail(entry),
  };
}

function sortFormats(formats: JsonLike[]): JsonLike[] {
  return [...formats].sort((left, right) => {
    const leftAudioOnly = left.acodec && left.acodec !== "none" && (!left.vcodec || left.vcodec === "none") ? 1 : 0;
    const rightAudioOnly = right.acodec && right.acodec !== "none" && (!right.vcodec || right.vcodec === "none") ? 1 : 0;
    if (leftAudioOnly !== rightAudioOnly) {
      return rightAudioOnly - leftAudioOnly;
    }

    const leftHasUrl = left.url ? 1 : 0;
    const rightHasUrl = right.url ? 1 : 0;
    if (leftHasUrl !== rightHasUrl) {
      return rightHasUrl - leftHasUrl;
    }

    const leftAudio = left.acodec && left.acodec !== "none" ? 1 : 0;
    const rightAudio = right.acodec && right.acodec !== "none" ? 1 : 0;
    if (leftAudio !== rightAudio) {
      return rightAudio - leftAudio;
    }

    const leftBitrate = Number(left.abr ?? left.tbr ?? left.asr ?? 0);
    const rightBitrate = Number(right.abr ?? right.tbr ?? right.asr ?? 0);
    return rightBitrate - leftBitrate;
  });
}

function summarizeFormats(formats: JsonLike[]) {
  return formats.slice(0, 5).map((format) => ({
    formatId: pickString(format.format_id) ?? null,
    ext: pickString(format.ext) ?? null,
    acodec: pickString(format.acodec) ?? null,
    vcodec: pickString(format.vcodec) ?? null,
    abr: Number(format.abr ?? format.tbr ?? 0),
    hasUrl: Boolean(format.url),
    protocol: pickString(format.protocol) ?? null,
  }));
}

export async function resolveYtDlpPlayback(
  videoId: string,
  cookieHeader?: string,
): Promise<ResolvedPlayback | null> {
  const attempts = [
    {
      label: "youtube-public",
      url: buildYouTubeUrl(videoId, "video"),
      cookieHeader: undefined,
    },
    {
      label: "ytmusic-auth",
      url: buildYtMusicUrl(videoId, "video"),
      cookieHeader,
    },
  ];

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const mediaUrl = await runTextQuery(attempt.url, attempt.cookieHeader, [
        "-g",
        "-f",
        "bestaudio/best",
        "--no-playlist",
      ]);
      return {
        url: mediaUrl,
        expiresAt: Date.now() + 1000 * 60 * 20,
        source: "yt-dlp",
      };
    } catch (error) {
      failures.push(
        `${attempt.label}:${error instanceof Error ? error.message : String(error)}`,
      );

      try {
        const info = await runJsonQuery(attempt.url, attempt.cookieHeader, ["--no-playlist"]);
        const formats = Array.isArray(info.formats) ? info.formats : [];
        const candidates = sortFormats(
          formats.filter((format) => format?.acodec && format.acodec !== "none"),
        );

        const selected = candidates.find((format) => typeof format.url === "string" && format.url);
        if (selected?.url) {
          return {
            url: selected.url,
            expiresAt: Date.now() + 1000 * 60 * 20,
            formatId: pickString(selected.format_id),
            source: "yt-dlp",
          };
        }

        if (typeof info.url === "string" && info.url) {
          return {
            url: info.url,
            expiresAt: Date.now() + 1000 * 60 * 20,
            formatId: pickString(info.format_id),
            source: "yt-dlp",
          };
        }
      } catch (jsonError) {
        failures.push(
          `${attempt.label}-json:${jsonError instanceof Error ? jsonError.message : String(jsonError)}`,
        );
      }
    }
  }

  log("ytmusic", "warn", "yt-dlp returned no playable format", {
    videoId,
    failures: failures.slice(0, 4),
  });
  return null;
}

export async function getYtDlpTrackMetadata(
  videoId: string,
  cookieHeader?: string,
): Promise<ResolvedTrack | null> {
  const info = await runJsonQuery(buildYtMusicUrl(videoId, "video"), cookieHeader, ["--no-playlist"]);
  return normalizeTrack(info);
}

export async function getYtDlpPlaylistItems(
  playlistId: string,
  cookieHeader?: string,
): Promise<ResolvedPlaylist | null> {
  const info = await runJsonQuery(buildYtMusicUrl(playlistId, "playlist"), cookieHeader);
  const entries = Array.isArray(info.entries) ? info.entries : [];
  const tracks = entries
    .map((entry) => normalizeTrack(entry))
    .filter((entry): entry is ResolvedTrack => entry != null);

  if (tracks.length === 0) {
    return null;
  }

  return {
    providerId: playlistId,
    name: pickString(info.title, info.playlist_title) ?? "Playlist",
    tracks,
  };
}
