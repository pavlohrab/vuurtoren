import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { GraduationCap, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, EmptyState, Skeleton, useToast } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { CourseListItem } from "../../services/courseTypes.js";
import "./courses.css";

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** Courses: the books you study along, with progress and a way to continue. */
export function Courses() {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<CourseListItem | null>(null);
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => services.courseList() });
  const remove = useMutation({
    mutationFn: (id: string) => services.deleteCourse(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["courses"] });
      toast("Course deleted");
    },
    onError: (e) => toast("Could not delete the course", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h1>Courses</h1>
        <Link to="/courses/import" className="k-btn k-btn--primary">
          <Plus size={16} aria-hidden /> Add a course
        </Link>
      </div>
      <p className="page-lede">
        Study along a textbook you own. The book stays on your device or your own server.
      </p>
      {courses.isPending ? (
        <Skeleton style={{ height: 90, borderRadius: 10 }} />
      ) : courses.isError ? (
        <p className="error-text">The courses could not be loaded. {String(courses.error)}</p>
      ) : courses.data.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={28} />}
          title="No courses yet"
          description="Upload a scanned book or a PDF. Kenning finds its units, exercises and word lists, and ties them to your Anki decks."
          action={
            <Button variant="primary" onClick={() => void navigate({ to: "/courses/import" })}>
              Add a course
            </Button>
          }
        />
      ) : (
        <ul className="cs-list">
          {courses.data.map((c) => (
            <li key={c.course.id} className="cs-card">
              <div>
                <h2>
                  <Link to="/courses/$courseId" params={{ courseId: c.course.id }}>
                    {c.course.title}
                  </Link>
                </h2>
                <p className="cs-meta">
                  {c.unitCount} units
                  {c.knownRatio !== null ? ` · ${percent(c.knownRatio)} of the words known` : ""}
                </p>
                {c.knownRatio !== null ? (
                  <div className="cs-bar" role="img" aria-label={`${percent(c.knownRatio)} known`}>
                    <span style={{ width: percent(c.knownRatio) }} />
                  </div>
                ) : null}
              </div>
              <div className="cs-actions">
                {c.continueUnit !== null ? (
                  <Link
                    to="/courses/$courseId/$unit"
                    params={{ courseId: c.course.id, unit: String(c.continueUnit) }}
                    className="k-btn k-btn--secondary"
                  >
                    Continue
                  </Link>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => setPendingDelete(c)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Delete this course"
        description={
          pendingDelete
            ? `"${pendingDelete.course.title}" and its exercises are removed. Texts already in your Library stay.`
            : ""
        }
      >
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (pendingDelete) remove.mutate(pendingDelete.course.id);
              setPendingDelete(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
