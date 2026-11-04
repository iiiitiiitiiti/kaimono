import "@fontsource-variable/noto-sans-jp";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setupPwa } from "./pwa";
import { trackViewport } from "./viewport";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

trackViewport();
setupPwa();
