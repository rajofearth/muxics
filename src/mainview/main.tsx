import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { getDesktopBridge } from "./desktop";

const desktop = getDesktopBridge();

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  desktop.send.showContextMenu();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App desktop={desktop} />
  </StrictMode>,
);
