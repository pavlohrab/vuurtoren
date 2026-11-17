import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";
import { createMockServices } from "./services/mock.js";
import type { AppServices } from "./services/types.js";
import { initTheme } from "./theme.js";

initTheme();

/**
 * Real services by default; `?demo` (or a failure to open the local database) uses mock data.
 */
async function createServices(): Promise<{ services: AppServices; notice?: string }> {
  if (new URLSearchParams(location.search).has("demo")) return { services: createMockServices() };
  try {
    const [{ createRepository }, { createWebDriver }, { createLiveServices }] = await Promise.all([
      import("@app/db"),
      import("@app/db/web"),
      import("./services/live.js"),
    ]);
    const driver = await createWebDriver("kenning");
    const repo = await createRepository(driver);
    // OPFS access handles are exclusive. Release them when the page is hidden (including the
    // back/forward cache, which keeps frozen pages alive), and reopen by reloading if a frozen
    // page is restored — otherwise the next page load could not open the database.
    addEventListener("pagehide", () => driver.terminate());
    addEventListener("pageshow", (e) => {
      if (e.persisted) location.reload();
    });
    const services = createLiveServices(repo);
    return driver.persistent
      ? { services }
      : {
          services,
          notice:
            "Your browser does not allow local storage here (private window or second tab), so data will not be saved.",
        };
  } catch (e) {
    console.error("Falling back to demo data:", e);
    return {
      services: createMockServices(),
      notice: "The local database could not be opened, so demo data is shown.",
    };
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

void createServices().then(({ services, notice }) => {
  if (notice) console.warn(notice);
  createRoot(root).render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  );
});
