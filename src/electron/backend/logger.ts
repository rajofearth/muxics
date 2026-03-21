export type LogLevel = "info" | "warn" | "error";

export function log(scope: string, level: LogLevel, message: string, extra?: unknown): void {
  const prefix = `[muxics:${scope}]`;
  const args: unknown[] = [prefix, message];
  if (extra !== undefined && extra !== null) {
    args.push(extra);
  }

  if (level === "error") {
    console.error(...args);
    return;
  }

  if (level === "warn") {
    console.warn(...args);
    return;
  }

  console.log(...args);
}
