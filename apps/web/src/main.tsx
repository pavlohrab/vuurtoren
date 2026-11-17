import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";
import { createMockServices } from "./services/mock.js";
import { initTheme } from "./theme.js";

initTheme();

// Swap `createMockServices()` for the real implementation once the backend is wired up.
const services = createMockServices();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
