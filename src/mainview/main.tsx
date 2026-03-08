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
      contextMenuAction: (payload) => {
        document.dispatchEvent(
          new CustomEvent("winamp-context-action", { detail: payload.action }),
        );
      },
      menuAction: (payload) => {
        document.dispatchEvent(
          new CustomEvent("winamp-menu-action", { detail: payload.action }),
        );
      },
    },
  },
});
const electrobun = new Electroview({ rpc });

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  electrobun.rpc?.send?.showContextMenu?.();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App electrobun={electrobun} />
  </StrictMode>,
);
