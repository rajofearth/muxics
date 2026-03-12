import path from "node:path";
import { parseFile } from "music-metadata";
import { AUDIO_EXTENSIONS } from "../../shared/constants";

const metadataCache = new Map<string, TrackMetadata>();

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  genre: string;
  picture?: string;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export async function getTrackMetadata(filePath: string): Promise<TrackMetadata | null> {
  const cached = metadataCache.get(filePath);
  if (cached) {
    return cached;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) {
    return null;
  }

  try {
    const metadata = await parseFile(filePath, { duration: true });
    const picture = metadata.common.picture?.[0];

    const result: TrackMetadata = {
      title: metadata.common.title ?? path.basename(filePath, ext),
      artist: metadata.common.artist ?? "Unknown Artist",
      album: metadata.common.album ?? "Unknown Album",
      duration: metadata.format.duration ?? 0,
      genre: metadata.common.genre?.[0] ?? "Unknown",
      picture: picture
        ? `data:${picture.format};base64,${Buffer.from(picture.data).toString("base64")}`
        : undefined,
    };

    metadataCache.set(filePath, result);
    return result;
  } catch {
    return null;
  }
}

export function formatMetadataTime(metadata: TrackMetadata): string {
  return formatDuration(metadata.duration);
}
