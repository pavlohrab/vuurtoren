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

/** A path kept for old links and bookmarks that redirects to its new home. */
function alias(path: string, to: "/" | "/talk") {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => {
      throw redirect({ to, replace: true });
    },
  });
}

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

/**
 * Optional string search params of a screen (filters, seeds). Numbers the router parsed from
 * the URL (`?q=12`) come back as strings; anything else is dropped.
 */
function stringParams<K extends string>(...keys: K[]) {
  return (raw: Record<string, unknown>): { [P in K]?: string } => {
    const out: { [P in K]?: string } = {};
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "string" && v !== "") out[k] = v;
      else if (typeof v === "number") out[k] = String(v);
    }
    return out;
  };
}

/** A code-split screen whose URL carries optional string search params. */
function searchScreen<P extends string, K extends string>(
  path: P,
  file: () => Promise<Record<string, unknown>>,
  name: string,
  keys: K[],
) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    validateSearch: stringParams(...keys),
    component: lazyRouteComponent(file as never, name),
  });
}

/** Read: the landing page (Today, Stories for you, Your texts). /home and /library lead here. */
const readHomeRoute = screen("/", () => import("./screens/Read.js"), "Read");
const homeAlias = alias("/home", "/");
const libraryAlias = alias("/library", "/");
const readRoute = screen("/read/$textId", () => import("./screens/ReaderPage.js"), "ReaderRoute");
const wordsOfTextRoute = screen(
  "/read/$textId/words",
  () => import("./screens/words/TextWords.js"),
  "TextWordsRoute",
);
/** /import?tab=paste|web|pdf|photo|story (story presets: topic, grammar, course + unit) */
const importRoute = searchScreen("/import", () => import("./screens/Import.js"), "ImportScreen", [
  "tab",
  "topic",
  "grammar",
  "course",
  "unit",
]);
/** /words?state=&source=text:<id>|unit:<course>/<n>|practice-again&level=1…10|other&group=level&q=&word=<key> */
const wordsRoute = searchScreen("/words", () => import("./screens/words/Words.js"), "Words", [
  "state",
  "source",
  "level",
  "group",
  "q",
  "word",
]);
/** /practice?words=a,b,c (practise these words) &start=1 (start at once, with the last options) */
const practiceRoute = searchScreen("/practice", () => import("./screens/Practice.js"), "Practice", [
  "words",
  "start",
]);
/** /talk?words=a,b&topic=… (seeded from Practice, Words, a unit or a text) */
const talkRoute = searchScreen("/talk", () => import("./screens/Converse.js"), "Converse", [
  "words",
  "topic",
]);
const converseAlias = alias("/converse", "/talk");
const grammarRoute = screen("/grammar", () => import("./screens/grammar/Grammar.js"), "Grammar");
const grammarTopicRoute = screen(
  "/grammar/$topic",
  () => import("./screens/grammar/Grammar.js"),
  "GrammarTopicRoute",
);
const topicPracticeRoute = screen(
  "/grammar/$topic/practice",
  () => import("./screens/Practice.js"),
  "TopicPracticeRoute",
);
const reviewRoute = screen("/review", () => import("./screens/review/Review.js"), "Review");
const progressRoute = screen("/progress", () => import("./screens/Progress.js"), "Progress");
/** /settings?section=words|reading|devices|ai|data (older names: language, sync, account, advanced) */
const settingsRoute = searchScreen(
  "/settings",
  () => import("./screens/settings/Settings.js"),
  "SettingsScreen",
  ["section"],
);
/** /exam: the A2 inburgeringsexamen overview; /exam/<part>?mode=practice|exam&set=1&theme=… */
const examRoute = screen("/exam", () => import("./screens/exam/Exam.js"), "Exam");
const examPartRoute = searchScreen(
  "/exam/$part",
  () => import("./screens/exam/ExamPart.js"),
  "ExamPartRoute",
  ["mode", "set", "theme"],
);
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
  readHomeRoute,
  homeAlias,
  libraryAlias,
  readRoute,
  wordsOfTextRoute,
  importRoute,
  wordsRoute,
  practiceRoute,
  talkRoute,
  converseAlias,
  grammarRoute,
  grammarTopicRoute,
  topicPracticeRoute,
  progressRoute,
  reviewRoute,
  settingsRoute,
  examRoute,
  examPartRoute,
  welcomeRoute,
  coursesRoute,
  courseImportRoute,
  courseEditRoute,
  courseRoute,
  unitRoute,
]);

/** Build the app router; pass a memory history in tests. */
export function createAppRouter(history?: RouterHistory) {
  // Route cross-fade through the View Transitions API; the router feature-detects it and
  // styles.css turns it off under reduced motion.
  return createRouter({
    routeTree,
    defaultViewTransition: true,
    ...(history ? { history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
