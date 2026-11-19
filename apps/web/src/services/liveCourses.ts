/**
 * Course services on top of the local database, the NLP server (OCR job, forms, analysis) and
 * Anki. Book content only ever lives in the user's own event log; nothing is sent anywhere but
 * the user's own NLP server. Anki writes are explicit clicks (Learn next, add notes), each
 * logged as an event.
 *
 * Composition of the course modules in ./courses/.
 */
import { createCourseAnki } from "./courses/anki.js";
import { type LiveCoursesDeps, createCourseContext } from "./courses/context.js";
import { createCourseGrammar } from "./courses/grammar.js";
import { createCourseImport } from "./courses/import.js";
import { createCoursePacks } from "./courses/packs.js";
import { createCoursePractice } from "./courses/practice.js";
import { createCourseViews } from "./courses/views.js";
import type { CourseServices } from "./courseTypes.js";

export type { LiveCoursesDeps };

/** Create the course part of AppServices. */
export function createLiveCourses(deps: LiveCoursesDeps): CourseServices {
  const ctx = createCourseContext(deps);
  const importer = createCourseImport(ctx);
  return {
    ...createCoursePacks(ctx, importer),
    ...importer.services,
    ...createCourseAnki(ctx),
    ...createCourseGrammar(ctx),
    ...createCourseViews(ctx),
    ...createCoursePractice(ctx),
    async deleteCourse(courseId) {
      await deps.repo.append({ type: "CourseDeleted", courseId });
      deps.changed();
    },
  };
}
