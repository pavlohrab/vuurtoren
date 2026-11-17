import { useParams } from "@tanstack/react-router";
import { CourseImportScreen } from "./CourseImport.js";
import { CourseRoute } from "./CoursePage.js";
import { UnitRoute } from "./UnitPage.js";

/** Route adapters: read the path params and render the screens. */
export function CourseImportRoute() {
  return <CourseImportScreen />;
}
export function CourseEditRoute() {
  const { courseId } = useParams({ from: "/courses/$courseId/edit" });
  return <CourseImportScreen courseId={courseId} />;
}
export function CourseRouteScreen() {
  const { courseId } = useParams({ from: "/courses/$courseId" });
  return <CourseRoute courseId={courseId} />;
}
export function UnitRouteScreen() {
  const { courseId, unit } = useParams({ from: "/courses/$courseId/$unit" });
  return <UnitRoute courseId={courseId} n={Number(unit)} />;
}
