export type LogLevel = "info" | "warn" | "error";

export function log(scope: string, level: LogLevel, message: string, extra?: unknown): void {
  const prefix = `[muxics:${scope}]`;

  if (level === "error") {
    console.error(prefix, message, extra ?? "");
    return;
  }

  if (level === "warn") {
    console.warn(prefix, message, extra ?? "");
    return;
  }

  console.log(prefix, message, extra ?? "");
}
