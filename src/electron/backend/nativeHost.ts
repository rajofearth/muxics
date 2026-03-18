import { getYtMusicAuthStatus, saveYtMusicCookieSession } from "./ytmusic";

type NativeMessage =
  | { type: "ping" }
  | { type: "get_status" }
  | { type: "import_session"; cookie: string };

function writeNativeMessage(payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

export function runNativeMessagingHost(): void {
  let buffer = Buffer.alloc(0);

  const handleMessage = async (message: NativeMessage) => {
    try {
      switch (message.type) {
        case "ping":
          writeNativeMessage({ success: true, app: "Muxics" });
          return;
        case "get_status": {
          const auth = await getYtMusicAuthStatus();
          writeNativeMessage({ success: true, auth });
          return;
        }
        case "import_session": {
          const result = saveYtMusicCookieSession(message.cookie);
          writeNativeMessage(result);
          return;
        }
        default:
          writeNativeMessage({ success: false, error: "Unknown native host message." });
      }
    } catch (error) {
      writeNativeMessage({
        success: false,
        error: error instanceof Error ? error.message : "Native host request failed.",
      });
    }
  };

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const messageLength = buffer.readUInt32LE(0);
      if (buffer.length < 4 + messageLength) {
        break;
      }

      const body = buffer.subarray(4, 4 + messageLength).toString("utf8");
      buffer = buffer.subarray(4 + messageLength);
      void handleMessage(JSON.parse(body) as NativeMessage);
    }
  });

  process.stdin.resume();
}
