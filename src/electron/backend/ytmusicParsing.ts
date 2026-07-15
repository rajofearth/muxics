import { Innertube, YTNodes } from "youtubei.js";
import type { PlaylistResult, TrackResult } from "../../shared/desktop-contract";
import { getCachedArtworkUrl } from "./ytMusicCache";
import {
  formatDuration,
  readDurationSeconds,
  sanitizeText,
} from "./ytmusicStrings";
import { uniqueById } from "./utils";
import { log } from "./logger";

type MusicResponsiveListItem = InstanceType<
  typeof YTNodes.MusicResponsiveListItem
>;
type MusicTwoRowItem = InstanceType<typeof YTNodes.MusicTwoRowItem>;

export type RawNode = Record<string, any>;

export type LibraryAuthState =
  | { authenticated: true; message?: undefined }
  | { authenticated: false; message: string };

export function getThumbnailUrl(item: any): string | undefined {
  if (!item) {
    return undefined;
  }

  // Handle case where it's already a wrapped results object from toTrackFromRaw
  // or has a direct thumbnails array (parsed youtubei.js nodes)
  if (Array.isArray(item.thumbnails)) {
    return item.thumbnails[item.thumbnails.length - 1]?.url;
  }

  // Helper: extract the last URL from a thumbnails array
  const pickLastThumbnailUrl = (
    thumbs: { url?: string }[] | undefined,
  ): string | undefined => thumbs?.[thumbs.length - 1]?.url;

  // Helper: drill into a thumbnail object (raw API structures)
  const resolveThumbnailRenderer = (obj: any): string | undefined => {
    if (!obj || typeof obj !== "object") return undefined;
    // Direct .thumbnails on the object itself (most common raw API pattern)
    if (Array.isArray(obj.thumbnails))
      return pickLastThumbnailUrl(obj.thumbnails);
    // Direct .thumbnail.thumbnails
    const direct = obj.thumbnail;
    if (direct && Array.isArray(direct.thumbnails))
      return pickLastThumbnailUrl(direct.thumbnails);
    // musicThumbnailRenderer wrapper
    const renderer = obj.musicThumbnailRenderer;
    if (renderer?.thumbnail && Array.isArray(renderer.thumbnail.thumbnails))
      return pickLastThumbnailUrl(renderer.thumbnail.thumbnails);
    return undefined;
  };

  // youtubei.js nodes often have .thumbnail as a Thumbnail object or Thumbnail[] array
  const thumbnail = item.thumbnail;
  if (thumbnail) {
    if (Array.isArray(thumbnail)) {
      return pickLastThumbnailUrl(thumbnail);
    }
    if (typeof thumbnail === "object" && "url" in thumbnail) {
      return thumbnail.url;
    }
    if (typeof thumbnail === "object" && Array.isArray(thumbnail.contents)) {
      return pickLastThumbnailUrl(thumbnail.contents);
    }
    // Try nested thumbnail renderer structures (raw YouTube API responses)
    if (typeof thumbnail === "object") {
      const result = resolveThumbnailRenderer(thumbnail);
      if (result) return result;
    }
  }

  // Try thumbnailRenderer sibling (alternative raw API structure)
  const thumbRenderer = item.thumbnailRenderer;
  if (thumbRenderer) {
    const result = resolveThumbnailRenderer(thumbRenderer);
    if (result) return result;
  }

  // Try item-level thumbnail renderer (some raw nodes have this at root)
  const musicRenderer = item.musicThumbnailRenderer;
  if (
    musicRenderer?.thumbnail &&
    Array.isArray(musicRenderer.thumbnail.thumbnails)
  ) {
    return pickLastThumbnailUrl(musicRenderer.thumbnail.thumbnails);
  }

  const thumbnails = item.thumbnails;
  if (Array.isArray(thumbnails)) {
    return pickLastThumbnailUrl(thumbnails);
  }

  return undefined;
}

function getCachedTrackPicture(
  providerId: string,
  sourceUrl?: string,
): string | undefined {
  return getCachedArtworkUrl(providerId, sourceUrl);
}

function readRunsText(runs?: Array<{ text?: string }>): string {
  return Array.isArray(runs)
    ? runs
        .map((run) => run.text ?? "")
        .join("")
        .trim()
    : "";
}

export function readText(raw: any): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw.simpleText === "string") return raw.simpleText.trim();
  return readRunsText(raw.runs);
}

function isLikelyVideoId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{11}$/.test(value) &&
    !/^(VL|PL|LM|MPR|FEmusic_)/.test(value)
  );
}

/** Strip app / browse prefixes so InnerTube gets a bare list id (e.g. PL…, LM…). */
export function normalizeBareYtMusicPlaylistId(playlistId: string): string {
  let id = playlistId.trim();
  id = id
    .replace(/^ytmusic-playlist:/i, "")
    .replace(/^ytmusic:/i, "")
    .trim();
  if (id.startsWith("VL") && id.length > 2) {
    id = id.slice(2);
  }
  return id;
}

/**
 * Reject channel rows, UI tokens, and other non-list browse ids that sometimes appear on shelves.
 * Prefer failing closed so we do not call /browse with ids like "SE".
 */
export function isPlausibleYtMusicPlaylistOrAlbumId(id: string): boolean {
  const t = id.trim();
  // Known special browse IDs that are valid despite being short
  if (t === "LM" || t === "SE" || t === "TP") {
    return true;
  }
  if (t.length < 4) {
    return false;
  }
  if (/^[A-Z]{1,3}$/.test(t)) {
    return false;
  }
  if (t.startsWith("UC")) {
    return false;
  }
  if (t.startsWith("FEmusic") || t.startsWith("FE")) {
    return false;
  }
  if (t.startsWith("MPRE") || t.startsWith("OLAK")) {
    return t.length >= 8;
  }
  if (t.startsWith("PL") || t.startsWith("LM")) {
    return t.length >= 6;
  }
  if (t.startsWith("RD")) {
    return t.length >= 8;
  }
  if (t.startsWith("VL")) {
    return t.length >= 10;
  }
  return t.length >= 12;
}

/** VL prefix is for list-style browse ids; album/release pages use bare MPRE/OLAK. */
export function browseIdForMusicBrowseRequest(playlistId: string): string {
  if (playlistId.startsWith("VL")) {
    return playlistId;
  }
  if (playlistId.startsWith("MPRE") || playlistId.startsWith("OLAK")) {
    return playlistId;
  }
  return `VL${playlistId}`;
}

/** InnerTube sometimes expects the browse-style id (VL + list id) for edit/delete. */
export function playlistIdsToTryOnInnertube(bareId: string): string[] {
  if (bareId.startsWith("VL")) {
    return [bareId];
  }
  const withVl = `VL${bareId}`;
  if (
    bareId.startsWith("PL") ||
    bareId.startsWith("LM") ||
    bareId.startsWith("OL")
  ) {
    return [bareId, withVl];
  }
  return [bareId];
}

export function readBrowseIdFromYtmusicSearchItem(item: any): string | undefined {
  const ep = item?.endpoint as { payload?: Record<string, any> } | undefined;
  const p = ep?.payload;
  if (!p || typeof p !== "object") {
    return undefined;
  }
  const nested =
    typeof p.browseEndpoint?.browseId === "string"
      ? p.browseEndpoint.browseId
      : undefined;
  const flat = typeof p.browseId === "string" ? p.browseId : undefined;
  return nested || flat || undefined;
}

export function findFirstVideoId(values: unknown[]): string | undefined {
  return values.find((value): value is string => isLikelyVideoId(value));
}

function collectWatchVideoIdsFromParsedFlexColumns(
  item: Record<string, any>,
): string[] {
  const cols = item.flex_columns;
  if (!Array.isArray(cols)) {
    return [];
  }
  const out: string[] = [];
  for (const col of cols) {
    const runs = col?.title?.runs ?? [];
    for (const run of runs) {
      const ep = run?.endpoint ?? run?.navigationEndpoint;
      const vid = ep?.payload?.videoId ?? ep?.payload?.watchEndpoint?.videoId;
      if (typeof vid === "string") {
        out.push(vid);
      }
    }
  }
  return out;
}

function readParsedItemPlayableVideoId(
  item: MusicResponsiveListItem | MusicTwoRowItem,
): string | undefined {
  const parsed = item as unknown as Record<string, any>;

  const menuItems =
    parsed?.menu?.items ?? parsed?.menu?.menu_renderer?.items ?? [];
  const topLevelButtons =
    parsed?.menu?.top_level_buttons ??
    parsed?.menu?.menu_renderer?.top_level_buttons ??
    [];
  const subtitleRuns = parsed?.subtitle?.runs ?? [];

  // Try direct properties first (fast path for common cases)
  const directId = findFirstVideoId([
    parsed.id,
    // Strip VL prefix from watch playlist IDs (e.g. "VLaJnj8d4P7Q8W4hObNqdWxAqU0P")
    typeof parsed.id === "string" && parsed.id.startsWith("VL")
      ? parsed.id.slice(2)
      : undefined,
    parsed.videoId,
    ...collectWatchVideoIdsFromParsedFlexColumns(parsed),
    parsed.video_id,
    parsed.videoId_,
    parsed.playlistItemData?.videoId,
    // Endpoint paths (common in parsed MusicResponsiveListItem)
    parsed.endpoint?.payload?.videoId,
    parsed.endpoint?.payload?.video_id,
    parsed.endpoint?.watchEndpoint?.videoId,
    parsed.navigationEndpoint?.watchEndpoint?.videoId,
    parsed.navigationEndpoint?.watchPlaylistEndpoint?.videoId,
    // Overlay paths
    parsed.overlay?.content?.play_button?.endpoint?.payload?.videoId,
    parsed.overlay?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
      ?.watchEndpoint?.videoId,
    parsed.thumbnail_overlay?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId,
    parsed.navigation_endpoint?.payload?.videoId,
    parsed.navigation_endpoint?.watch_endpoint?.video_id,
    // Raw data fallback
    parsed.raw_data?.videoId,
    parsed.raw_data?.navigationEndpoint?.watchEndpoint?.videoId,
    // Subtitle runs
    ...subtitleRuns.map((run: any) => run?.endpoint?.payload?.videoId),
    // Menu items
    ...menuItems.map(
      (item: any) =>
        item?.navigation_endpoint?.watch_endpoint?.video_id ||
        item?.navigation_endpoint?.watch_endpoint?.videoId ||
        item?.service_endpoint?.queue_add_endpoint?.queue_target?.video_id ||
        item?.service_endpoint?.queue_add_endpoint?.queue_target?.videoId,
    ),
    // Top-level buttons
    ...topLevelButtons.map(
      (item: any) =>
        item?.navigation_endpoint?.watch_endpoint?.video_id ||
        item?.navigation_endpoint?.watch_endpoint?.videoId ||
        item?.button_renderer?.navigation_endpoint?.watch_endpoint?.video_id,
    ),
  ]);
  if (directId) return directId;

  return undefined;
}

export function toTrack(
  item: MusicResponsiveListItem | MusicTwoRowItem,
): TrackResult | null {
  const providerId = readParsedItemPlayableVideoId(item);
  if (!providerId) {
    return null;
  }

  const itemAny = item as any;

  const title =
    itemAny.title?.toString() || itemAny.name?.toString() || "Unknown Track";

  const artists =
    Array.isArray(itemAny.artists) && itemAny.artists.length > 0
      ? itemAny.artists
          .map((artist: { name?: string }) => artist.name)
          .filter(Boolean)
          .join(", ")
      : itemAny.author?.name ||
        itemAny.subtitle?.toString() ||
        "Unknown Artist";

  const album =
    itemAny.album?.name ||
    (itemAny.subtitle?.toString()?.includes(" • ")
      ? itemAny.subtitle.toString().split(" • ")[0]
      : "Single");

  const durationParsed = itemAny.duration;
  let seconds =
    typeof durationParsed === "object"
      ? durationParsed?.seconds
      : typeof durationParsed === "number"
        ? durationParsed
        : undefined;
  let time =
    seconds !== undefined
      ? typeof durationParsed === "object"
        ? (durationParsed?.text ?? formatDuration(seconds))
        : typeof durationParsed === "string"
          ? durationParsed
          : formatDuration(seconds)
      : undefined;

  // Fallback: extract duration from subtitle / flex columns raw data
  // (MusicTwoRowItem in home feed carousels often lacks .duration
  //  but the info is present in the subtitle runs or raw text)
  if (seconds === undefined || time === undefined) {
    const candidateTexts: string[] = [];

    // Check subtitle runs for a "M:SS" or "H:MM:SS" pattern
    const subtitleRuns = itemAny.subtitle?.runs ?? [];
    for (const run of subtitleRuns) {
      const text = run?.text ?? "";
      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
        candidateTexts.push(text);
      }
    }

    // Check the full subtitle text for trailing duration
    const subtitleText = itemAny.subtitle?.toString() ?? "";
    const durMatch = subtitleText.match(/(\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (durMatch) {
      candidateTexts.push(durMatch[1]);
    }

    // Check flex columns (raw renderer data) for duration
    const flexCols = itemAny.flexColumns ?? itemAny.flex_columns ?? [];
    for (const col of flexCols) {
      const colText = col?.title?.toString() ?? col?.toString() ?? "";
      const m = colText.match(/(\d{1,2}:\d{2}(?::\d{2})?)$/);
      if (m) candidateTexts.push(m[1]);
    }

    // Fixed columns (duration is often here in list items)
    const fixedCols = itemAny.fixedColumns ?? itemAny.fixed_columns ?? [];
    for (const col of fixedCols) {
      const colText = col?.title?.toString() ?? col?.toString() ?? "";
      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(colText)) {
        candidateTexts.push(colText);
      }
    }

    // Use the first valid candidate found
    for (const text of candidateTexts) {
      if (text) {
        const parts = text.split(":").map(Number);
        const s =
          parts.length === 3
            ? parts[0] * 3600 + parts[1] * 60 + parts[2]
            : parts[0] * 60 + parts[1];
        if (s > 0) {
          seconds = s;
          time = text;
          break;
        }
      }
    }

    // Last resort: still show a placeholder if truly unknown
    if (seconds === undefined) {
      time = "—";
    }
  }

  // Extract liked status from menu items if available
  let liked = false;
  try {
    const menuItems = itemAny.menu?.items || [];
    for (const menuItem of menuItems) {
      const toggleRenderer = menuItem.as?.(YTNodes.ToggleMenuServiceItem);
      if (toggleRenderer) {
        const iconType =
          toggleRenderer.icon_type || toggleRenderer.default_icon_type;
        if (iconType === "FAVORITE" || iconType === "LIKE") {
          liked = toggleRenderer.is_toggled || (toggleRenderer as any).toggled;
          break;
        }
      }
    }
  } catch {
    // Fallback for raw data or other structures
    const menuItems =
      itemAny.menu?.items || itemAny.menu?.menu_renderer?.items || [];
    for (const m of menuItems) {
      const entry =
        m.menuNavigationItemRenderer ||
        m.menuServiceItemRenderer ||
        m.toggleMenuServiceItemRenderer;
      if (entry) {
        const iconType =
          entry.defaultIcon?.iconType ||
          entry.default_icon_type ||
          entry.icon_type;
        if (iconType === "FAVORITE" || iconType === "LIKE") {
          liked = !!(entry.isToggled || entry.is_toggled || entry.toggled);
          break;
        }
      }
    }
  }

  return {
    id: `ytmusic:${providerId}`,
    provider: "ytmusic",
    providerId,
    title: sanitizeText(title, "Unknown Track"),
    artist: sanitizeText(artists, "Unknown Artist"),
    album: sanitizeText(album, "Single"),
    duration: seconds ?? 0,
    time: time || "—",
    genre: "YouTube Music",
    picture: getCachedTrackPicture(providerId, getThumbnailUrl(item)),
    sourceLabel: "YouTube Music",
    liked,
  };
}

export function toPlaylist(item: any): PlaylistResult | null {
  const itemAny = item as any;
  const name = itemAny.title?.toString() || itemAny.name?.toString();
  if (!name) return null;

  if (
    itemAny.item_type === "artist" ||
    itemAny.item_type === "library_artist"
  ) {
    return null;
  }

  const id =
    readBrowseIdFromYtmusicSearchItem(itemAny) ||
    itemAny.endpoint?.payload?.browseEndpoint?.browseId ||
    itemAny.id ||
    itemAny.endpoint?.payload?.browseId ||
    itemAny.browseId;
  if (!id || !isPlausibleYtMusicPlaylistOrAlbumId(id)) {
    return null;
  }

  // YT Music Album IDs usually start with MPRE or OLAK
  const isAlbum =
    id.startsWith("MPRE") ||
    id.startsWith("OLAK") ||
    itemAny.item_type === "album";
  const itemType = isAlbum ? "album" : "playlist";

  return {
    id: `ytmusic:${id}`,
    provider: "ytmusic",
    providerId: id,
    name: sanitizeText(name, "Unknown Playlist"),
    author:
      itemAny.author?.name || itemAny.subtitle?.toString() || "YouTube Music",
    picture: getThumbnailUrl(itemAny),
    type: itemType,
    listedItemCount:
      typeof itemAny.item_count === "number" ? itemAny.item_count : undefined,
    entries: [],
    // Home feed items (Mixes, Albums) should generally not show edit/delete icons
    editable: false,
  };
}

function collectWatchVideoIdsFromFlexColumns(renderer: RawNode): string[] {
  const cols = renderer?.flexColumns;
  if (!Array.isArray(cols)) {
    return [];
  }
  const out: string[] = [];
  for (const col of cols) {
    const runs =
      col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
    for (const run of runs) {
      const vid = run?.navigationEndpoint?.watchEndpoint?.videoId;
      if (typeof vid === "string") {
        out.push(vid);
      }
    }
  }
  return out;
}

export function readRendererPlayableVideoId(renderer: RawNode): string | undefined {
  const menuItems = renderer?.menu?.menuRenderer?.items ?? [];
  const topLevelButtons = renderer?.menu?.menuRenderer?.topLevelButtons ?? [];
  const subtitleRuns =
    renderer?.subtitle?.runs ??
    renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs ??
    [];

  return findFirstVideoId([
    renderer?.playlistItemData?.videoId,
    renderer?.navigationEndpoint?.watchEndpoint?.videoId,
    ...collectWatchVideoIdsFromFlexColumns(renderer),
    renderer?.navigationEndpoint?.watchPlaylistEndpoint?.videoId,
    renderer?.navigationEndpoint?.browseEndpoint?.browseId,
    renderer?.navigationEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig?.musicVideoType === "MUSIC_VIDEO_TYPE_ATV"
      ? renderer?.navigationEndpoint?.watchEndpoint?.videoId
      : undefined,
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId,
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId,
    ...subtitleRuns.map((run: any) => run?.endpoint?.payload?.videoId),
    ...menuItems.map(
      (item: any) =>
        item?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint
          ?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.menuNavigationItemRenderer?.navigationEndpoint
          ?.watchPlaylistEndpoint?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.menuServiceItemRenderer?.serviceEndpoint?.queueAddEndpoint
          ?.queueTarget?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.toggleMenuServiceItemRenderer?.defaultServiceEndpoint
          ?.queueAddEndpoint?.queueTarget?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.toggleMenuServiceItemRenderer?.toggledServiceEndpoint
          ?.queueAddEndpoint?.queueTarget?.videoId,
    ),
    ...topLevelButtons.map(
      (button: any) =>
        button?.buttonRenderer?.navigationEndpoint?.watchEndpoint?.videoId,
    ),
    ...topLevelButtons.map(
      (button: any) =>
        button?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint
          ?.videoId,
    ),
  ]);
}

function readRendererPlaylistId(renderer: RawNode): string | undefined {
  return (
    renderer?.navigationEndpoint?.browseEndpoint?.browseId ??
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId ??
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId
  );
}

export function toTrackFromRaw(renderer: RawNode): TrackResult | null {
  const providerId = readRendererPlayableVideoId(renderer);
  if (!providerId) {
    return null;
  }

  const title =
    readText(
      renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text,
    ) ||
    readText(renderer.title) ||
    "Unknown Track";

  const detailRuns =
    renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs ??
    renderer.subtitle?.runs ??
    [];

  const artists = detailRuns
    .filter((run: any) =>
      run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith?.("UC"),
    )
    .map((run: any) => run.text)
    .join(", ");

  const albumRun = detailRuns.find((run: any) =>
    run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith?.("MPR"),
  );
  const durationText =
    detailRuns.find((run: any) =>
      /^\d{1,2}:\d{2}(?::\d{2})?$/.test(run?.text ?? ""),
    )?.text ??
    readText(
      renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer
        ?.text,
    );

  let liked = false;
  const menuItems = renderer?.menu?.menuRenderer?.items ?? [];
  for (const m of menuItems) {
    const entry = m.toggleMenuServiceItemRenderer;
    if (
      entry?.defaultIcon?.iconType === "FAVORITE" ||
      entry?.default_icon_type === "FAVORITE"
    ) {
      liked = !!(entry.isToggled || entry.is_toggled);
      break;
    }
  }

  const unknownDuration = !durationText;
  return {
    id: `ytmusic:${providerId}`,
    provider: "ytmusic",
    providerId,
    title: sanitizeText(title, "Unknown Track"),
    artist: sanitizeText(
      artists || readText(renderer.subtitle),
      "Unknown Artist",
    ),
    album: sanitizeText(albumRun?.text ?? "Single", "Single"),
    duration: unknownDuration ? 0 : readDurationSeconds(durationText),
    time: unknownDuration ? "—" : durationText,
    genre: "YouTube Music",
    picture: getCachedTrackPicture(providerId, getThumbnailUrl(renderer)),
    sourceLabel: "YouTube Music",
    liked,
  };
}

export function summarizeFailedTrackRenderer(renderer: RawNode) {
  return {
    title:
      readText(renderer?.title) ||
      readText(
        renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
          ?.text,
      ) ||
      null,
    navigationEndpoint: renderer?.navigationEndpoint ?? null,
    thumbnailOverlay: renderer?.thumbnailOverlay ?? null,
    menuItems: (renderer?.menu?.menuRenderer?.items ?? []).slice(0, 2),
    topLevelButtons: (
      renderer?.menu?.menuRenderer?.topLevelButtons ?? []
    ).slice(0, 2),
  };
}

function readNestedBrowseEndpoint(node: RawNode): RawNode | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.browseEndpoint && typeof node.browseEndpoint === "object") {
    return node.browseEndpoint;
  }

  const persistCommand =
    node.musicLibraryPersistLaunchNavigationCommand?.command;
  if (persistCommand) {
    const nestedPersistEndpoint = readNestedBrowseEndpoint(persistCommand);
    if (nestedPersistEndpoint) {
      return nestedPersistEndpoint;
    }
  }

  const commandExecutorCommands = node.commandExecutorCommand?.commands;
  if (Array.isArray(commandExecutorCommands)) {
    for (const command of commandExecutorCommands) {
      const nestedCommandEndpoint = readNestedBrowseEndpoint(command);
      if (nestedCommandEndpoint) {
        return nestedCommandEndpoint;
      }
    }
  }

  const nestedCandidates = [
    node.navigationEndpoint,
    node.onSelectCommand,
    node.serviceEndpoint,
    node.command,
  ];

  for (const candidate of nestedCandidates) {
    const nestedEndpoint = readNestedBrowseEndpoint(candidate);
    if (nestedEndpoint) {
      return nestedEndpoint;
    }
  }

  return null;
}

export function readChipBrowseEndpoint(
  chip: RawNode | undefined | null,
): RawNode | null {
  if (!chip) {
    return null;
  }
  return readNestedBrowseEndpoint(chip);
}

function parsePlaylistListedCountFromRenderer(
  renderer: RawNode,
): number | undefined {
  const text = readText(renderer.subtitle);
  const m = text.match(/([\d,]+)\s*(?:songs?|tracks?)/i);
  if (!m) {
    return undefined;
  }
  const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

export function toPlaylistFromRaw(renderer: RawNode): PlaylistResult | null {
  const providerId = readRendererPlaylistId(renderer);
  if (
    !providerId ||
    (!providerId.startsWith("VL") &&
      !providerId.startsWith("PL") &&
      !providerId.startsWith("LM"))
  ) {
    return null;
  }

  const name =
    readText(renderer.title) ||
    readText(
      renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text,
    ) ||
    "Playlist";
  return {
    id: `ytmusic:${providerId.replace(/^VL/, "")}`,
    provider: "ytmusic",
    providerId: providerId.replace(/^VL/, ""),
    name,
    editable: true,
    entries: [],
    listedItemCount: parsePlaylistListedCountFromRenderer(renderer),
  };
}

export function mergePlaylistSummaryWithCachedDetail(
  summary: PlaylistResult,
  cached: PlaylistResult | undefined,
): PlaylistResult {
  if (!cached) {
    return summary;
  }

  const cachedEntries =
    cached.entries.length > 0
      ? cached.entries
      : cached.tracks && cached.tracks.length > 0
        ? toPlaylistEntries(cached.tracks)
        : [];

  const hasTrackDetail = cachedEntries.length > 0;
  const hasHint =
    typeof cached.listedItemCount === "number" && cached.listedItemCount > 0;

  if (!hasTrackDetail && !hasHint) {
    return summary;
  }

  return {
    ...summary,
    entries: hasTrackDetail ? cachedEntries : summary.entries,
    tracks: cached.tracks?.length ? cached.tracks : summary.tracks,
    listedItemCount: cached.listedItemCount ?? summary.listedItemCount,
  };
}

export function toPlaylistEntries(tracks: TrackResult[]) {
  return tracks.map((track) => ({
    id: track.id,
    provider: track.provider,
    providerId: track.providerId,
    title: track.title,
  }));
}

export async function collectPlaylistItems(
  playlist: Awaited<ReturnType<Innertube["music"]["getPlaylist"]>>,
) {
  const items = [...playlist.items];
  let current = playlist;

  log(
    "ytmusic",
    "info",
    `collectPlaylistItems: starting with ${items.length} initial items`,
  );

  while (current.has_continuation) {
    try {
      current = await current.getContinuation();
      items.push(...current.items);
      log(
        "ytmusic",
        "info",
        `collectPlaylistItems: fetched continuation, now have ${items.length} items`,
      );
    } catch (err) {
      log(
        "ytmusic",
        "error",
        "collectPlaylistItems: failed to fetch continuation",
        err,
      );
      break;
    }
  }

  const tracks = items
    .map((item, idx) => {
      const track = toTrack(item as MusicResponsiveListItem | MusicTwoRowItem);
      if (!track) {
        log(
          "ytmusic",
          "warn",
          `collectPlaylistItems: failed to parse item at index ${idx}`,
          {
            type: (item as any).type,
            keys: Object.keys(item),
          },
        );
      }
      return track;
    })
    .filter((item): item is TrackResult => item != null);

  log(
    "ytmusic",
    "info",
    `collectPlaylistItems: finished with ${tracks.length} parsed tracks out of ${items.length} total items`,
  );
  return uniqueById(tracks);
}

export function collectRenderers(
  node: any,
  key: string,
  results: RawNode[] = [],
): RawNode[] {
  if (!node || typeof node !== "object") {
    return results;
  }

  if (key in node && node[key] && typeof node[key] === "object") {
    results.push(node[key]);
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectRenderers(item, key, results);
    }
    return results;
  }

  for (const value of Object.values(node)) {
    collectRenderers(value, key, results);
  }

  return results;
}

export function collectCandidateMusicNodes(
  node: any,
  results: RawNode[] = [],
): RawNode[] {
  if (!node || typeof node !== "object") {
    return results;
  }

  if (
    Array.isArray(node?.flexColumns) ||
    Array.isArray(node?.runs) ||
    node?.playlistItemData?.videoId ||
    node?.musicItemThumbnailOverlayRenderer ||
    node?.musicPlayButtonRenderer
  ) {
    results.push(node);
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectCandidateMusicNodes(item, results);
    }
    return results;
  }

  for (const value of Object.values(node)) {
    collectCandidateMusicNodes(value, results);
  }

  return results;
}

function collectRendererKeyCounts(
  node: any,
  counts = new Map<string, number>(),
): Map<string, number> {
  if (!node || typeof node !== "object") {
    return counts;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectRendererKeyCounts(item, counts);
    }
    return counts;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.endsWith("Renderer")) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    collectRendererKeyCounts(value, counts);
  }

  return counts;
}

export function getTopRendererKeys(node: any, limit = 20): Array<[string, number]> {
  return [...collectRendererKeyCounts(node).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

export function getLibraryMessageSummary(node: any) {
  const message = collectRenderers(node, "messageRenderer")[0];
  const subtext = collectRenderers(node, "messageSubtextRenderer")[0];
  const button = collectRenderers(node, "buttonRenderer")[0];

  return {
    message: message ? readText(message.text) : "",
    subtext: subtext ? readText(subtext.text) : "",
    button: button ? readText(button.text) : "",
  };
}

export function classifyLibraryAuthState(node: any): LibraryAuthState {
  const summary = getLibraryMessageSummary(node);
  const normalizedMessage =
    `${summary.message} ${summary.subtext} ${summary.button}`.toLowerCase();
  const signedOut =
    normalizedMessage.includes("sign in") ||
    normalizedMessage.includes("access tracks that you liked or saved") ||
    normalizedMessage.includes("explore your favorites");

  if (signedOut) {
    return {
      authenticated: false,
      message:
        "Imported browser session is not being accepted by YouTube Music. Please reload the extension from a logged-in music.youtube.com tab and retry.",
    };
  }

  return { authenticated: true };
}

export function extractContinuationToken(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  // Try continuationContents (continuation page response)
  if (data.continuationContents) {
    for (const value of Object.values(data.continuationContents)) {
      const container = value as any;
      if (container?.continuations?.[0]?.nextContinuationData?.continuation) {
        return container.continuations[0].nextContinuationData.continuation;
      }
      if (container?.continuations?.[0]?.reloadContinuationData?.continuation) {
        return container.continuations[0].reloadContinuationData.continuation;
      }
    }
    // No continuation token found in continuationContents means we're on the last page
    return null;
  }

  // Try shelf/browse continuations (initial page - contents is an array of sections)
  if (Array.isArray(data.contents)) {
    for (const section of data.contents) {
      const shelf =
        section?.musicShelfRenderer || section?.musicCarouselShelfRenderer;
      if (shelf?.continuations?.[0]?.nextContinuationData?.continuation) {
        return shelf.continuations[0].nextContinuationData.continuation;
      }
      if (shelf?.continuations?.[0]?.reloadContinuationData?.continuation) {
        return shelf.continuations[0].reloadContinuationData.continuation;
      }
    }
  }

  // Try sectionListRenderer continuations (initial page with section list)
  if (Array.isArray(data.contents)) {
    const sectionList = data.contents[0]?.sectionListRenderer;
    if (sectionList?.continuations?.[0]?.nextContinuationData?.continuation) {
      return sectionList.continuations[0].nextContinuationData.continuation;
    }
    if (sectionList?.continuations?.[0]?.reloadContinuationData?.continuation) {
      return sectionList.continuations[0].reloadContinuationData.continuation;
    }
  }

  return null;
}
