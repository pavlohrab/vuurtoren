import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { AppShell } from "./shell/AppShell.js";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/library" });
  },
});

/** Declare a code-split screen route. */
function screen<P extends string>(
  path: P,
  file: () => Promise<Record<string, unknown>>,
  name: string,
) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: lazyRouteComponent(file as never, name),
  });
}

const libraryRoute = screen("/library", () => import("./screens/Library.js"), "Library");
const readRoute = screen("/read/$textId", () => import("./screens/ReaderPage.js"), "ReaderRoute");
const importRoute = screen("/import", () => import("./screens/Import.js"), "ImportScreen");
const wordsRoute = screen("/words", () => import("./screens/Words.js"), "Words");
const practiceRoute = screen("/practice", () => import("./screens/Placeholders.js"), "Practice");
const converseRoute = screen("/converse", () => import("./screens/Placeholders.js"), "Converse");
const grammarRoute = screen("/grammar", () => import("./screens/Placeholders.js"), "Grammar");
const progressRoute = screen("/progress", () => import("./screens/Progress.js"), "Progress");
const settingsRoute = screen("/settings", () => import("./screens/Settings.js"), "SettingsScreen");

const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  readRoute,
  importRoute,
  wordsRoute,
  practiceRoute,
  converseRoute,
  grammarRoute,
  progressRoute,
  settingsRoute,
]);

/** Build the app router; pass a memory history in tests. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
