export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
  ".wav",
  ".aiff",
  ".webm",
]);

export const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".webm": "audio/webm",
};

export const APP_NAME = "Muse";
export const APP_ID = "dev.muse.player";
export const APP_DATA_ID = "muse.player";
export const LEGACY_APP_DATA_IDS = [
  "muse.electrobun.dev",
  "winampplayer.electrobun.dev",
] as const;
