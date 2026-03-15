import type { DesktopBridge } from "../shared/desktop-contract";

type WindowWithDesktop = Window &
  typeof globalThis & {
    muxicsDesktop?: DesktopBridge;
  };

function createUnavailableProxy<T extends object>(kind: "request" | "send"): T {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (kind === "request") {
          return async () => {
            throw new Error(
              `Desktop bridge request "${String(property)}" is not available.`,
            );
          };
        }

        return () => {
          console.warn(
            `Desktop bridge message "${String(property)}" was called before preload initialization.`,
          );
        };
      },
    },
  ) as T;
}

const fallbackBridge: DesktopBridge = {
  request: createUnavailableProxy<DesktopBridge["request"]>("request"),
  send: createUnavailableProxy<DesktopBridge["send"]>("send"),
};

export function getDesktopBridge(): DesktopBridge {
  return (window as WindowWithDesktop).muxicsDesktop ?? fallbackBridge;
}
