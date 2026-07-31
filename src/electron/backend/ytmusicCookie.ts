/** The normalized Cookie header used by YT Music integrations. */
export interface YtMusicSessionCookie {
  readonly value: string;
}

export function createYtMusicSessionCookie(value: string): YtMusicSessionCookie {
  return Object.freeze({ value });
}

export function serializeYtMusicSessionCookie(
  cookie: YtMusicSessionCookie,
): string {
  return cookie.value;
}
