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

export const APP_NAME = "Muxics";
export const APP_ID = "dev.muxics.player";
export const APP_DATA_ID = "muxics.player";
export const LEGACY_APP_DATA_IDS = [
  "muse.player",
  "muse.electrobun.dev",
  "winampplayer.electrobun.dev",
] as const;
