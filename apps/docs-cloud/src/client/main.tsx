import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { startEmbedBridge } from "./embedBridge.ts";
import "./styles.css";
import { startTheme } from "./theme.ts";

startTheme();
startEmbedBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
