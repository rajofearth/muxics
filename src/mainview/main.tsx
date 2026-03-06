import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Electroview } from "electrobun/view";
import type { WinampRPCSchema } from "../shared/rpc-types";
import "./index.css";
import App from "./App";

const rpc = Electroview.defineRPC<WinampRPCSchema>({
  maxRequestTime: 60_000,
  handlers: {
    requests: {},
    messages: {
      contextMenuAction: (payload: { action: string }) => {
        document.dispatchEvent(
          new CustomEvent("winamp-context-action", { detail: payload.action })
        );
      },
    },
  },
});
const electrobun = new Electroview({ rpc });

// Prevent default context menu; App shows custom Winamp-styled menu
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  document.dispatchEvent(
    new CustomEvent("winamp-show-context-menu", {
      detail: { x: e.clientX, y: e.clientY },
    })
  );
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App electrobun={electrobun} />
  </StrictMode>
);
