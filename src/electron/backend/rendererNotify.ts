type CacheStatsListener = () => void;

let ytMusicCacheStatsListener: CacheStatsListener | null = null;

export function setYtMusicCacheStatsListener(fn: CacheStatsListener | null): void {
  ytMusicCacheStatsListener = fn;
}

export function notifyYtMusicCacheStatsChanged(): void {
  ytMusicCacheStatsListener?.();
}
