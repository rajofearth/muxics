export const parseTime = (timeStr: string): number => {
  const [min, sec] = timeStr.split(":").map(Number);
  return (min ?? 0) * 60 + (sec ?? 0);
};

export const formatTime = (seconds: number): string => {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

export const formatTotalDuration = (tracks: { time: string; duration?: number }[]): string => {
  const totalSec = tracks.reduce((sum, track) => sum + (track.duration ?? parseTime(track.time)), 0);
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${min}m`;
  }
  return `${min} min`;
};
