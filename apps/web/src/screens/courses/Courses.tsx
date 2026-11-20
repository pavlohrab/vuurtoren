import { pct } from "../../format.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../shell/PageHeader.js";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileUp, GraduationCap, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, CoverageMeter, Dialog, EmptyState, Skeleton, useToast } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { CourseListItem } from "../../services/courseTypes.js";
import { ImportPackDialog } from "./CoursePacks.js";
import { MenuButton } from "../library/MenuButton.js";
import { ErrorNotice } from "../../shell/ErrorNotice.js";
import "./courses.css";
import { errorText } from "../../services/errors.js";

/** Courses: the books you study along, with progress and a way to continue. */
export function Courses() {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<CourseListItem | null>(null);
  const [importing, setImporting] = useState(false);
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => services.courseList() });
  const remove = useMutation({
    mutationFn: (id: string) => services.deleteCourse(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["courses"] });
      toast("Course deleted");
    },
    onError: (e) => toast("Could not delete the course", errorText(e)),
  });

  return (
    <div className="page">
      <PageHeader
        title="Courses"
        lede="Study along a textbook you own. The book stays on your device or your own server."
        actions={
          <>
            <Button onClick={() => setImporting(true)}>
              <FileUp size={16} aria-hidden /> Import a course pack
            </Button>
            <Link to="/courses/import" className="k-btn k-btn--primary">
              <Plus size={16} aria-hidden /> Add a course
            </Link>
          </>
        }
      />
      {courses.isPending ? (
        <Skeleton style={{ height: 90, borderRadius: 10 }} />
      ) : courses.isError ? (
        <ErrorNotice
          title="The courses could not be loaded."
          error={courses.error}
          onRetry={() => void courses.refetch()}
        />
      ) : courses.data.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={20} />}
          title="No courses yet"
          description="Upload a scanned book or a PDF. Vuurtoren finds its units, exercises and word lists, and ties them to your Anki decks."
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
                  {c.knownRatio !== null ? ` · ${pct(c.knownRatio)} of the words known` : ""}
                </p>
                {c.knownRatio !== null ? (
                  <CoverageMeter value={c.knownRatio} block hideValue label="Words known" />
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
                <MenuButton
                  label={`More for ${c.course.title}`}
                  items={[
                    {
                      label: "Delete course…",
                      icon: <Trash2 size={16} aria-hidden />,
                      danger: true,
                      onSelect: () => setPendingDelete(c),
                    },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <ImportPackDialog open={importing} onOpenChange={setImporting} />
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
            variant="danger"
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
