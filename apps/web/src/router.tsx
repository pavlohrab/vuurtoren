import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { Root } from "./shell/Root.js";

const rootRoute = createRootRoute({ component: Root });

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
const wordsOfTextRoute = screen(
  "/read/$textId/words",
  () => import("./screens/TextWords.js"),
  "TextWordsRoute",
);
const importRoute = screen("/import", () => import("./screens/Import.js"), "ImportScreen");
const wordsRoute = screen("/words", () => import("./screens/Words.js"), "Words");
const practiceRoute = screen("/practice", () => import("./screens/Practice.js"), "Practice");
const converseRoute = screen("/converse", () => import("./screens/Converse.js"), "Converse");
const grammarRoute = screen("/grammar", () => import("./screens/Grammar.js"), "Grammar");
const grammarTopicRoute = screen(
  "/grammar/$topic",
  () => import("./screens/Grammar.js"),
  "GrammarTopicRoute",
);
const topicPracticeRoute = screen(
  "/grammar/$topic/practice",
  () => import("./screens/Practice.js"),
  "TopicPracticeRoute",
);
const progressRoute = screen("/progress", () => import("./screens/Progress.js"), "Progress");
const settingsRoute = screen("/settings", () => import("./screens/Settings.js"), "SettingsScreen");
const welcomeRoute = screen("/welcome", () => import("./screens/onboarding/Welcome.js"), "Welcome");

const coursesRoute = screen("/courses", () => import("./screens/courses/Courses.js"), "Courses");
const courseImportRoute = screen(
  "/courses/import",
  () => import("./screens/courses/routes.js"),
  "CourseImportRoute",
);
const courseEditRoute = screen(
  "/courses/$courseId/edit",
  () => import("./screens/courses/routes.js"),
  "CourseEditRoute",
);
const courseRoute = screen(
  "/courses/$courseId",
  () => import("./screens/courses/routes.js"),
  "CourseRouteScreen",
);
const unitRoute = screen(
  "/courses/$courseId/$unit",
  () => import("./screens/courses/routes.js"),
  "UnitRouteScreen",
);

const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  readRoute,
  wordsOfTextRoute,
  importRoute,
  wordsRoute,
  practiceRoute,
  converseRoute,
  grammarRoute,
  grammarTopicRoute,
  topicPracticeRoute,
  progressRoute,
  settingsRoute,
  welcomeRoute,
  coursesRoute,
  courseImportRoute,
  courseEditRoute,
  courseRoute,
  unitRoute,
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
