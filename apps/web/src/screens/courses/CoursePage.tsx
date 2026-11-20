import { pct } from "../../format.js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, CoverageMeter, Skeleton, useNativeMode } from "@app/ui";
import { useServices } from "../../services/context.js";
import { PageHeader } from "../../shell/PageHeader.js";
import type { UnitRow } from "../../services/courseTypes.js";
import { AddWordsDialog } from "./AddWordsDialog.js";
import { ExportPackDialog } from "./CoursePacks.js";
import "./courses.css";

function UnitLine({ courseId, row }: { courseId: string; row: UnitRow }) {
  const { unit, status } = row;
  const hasWords = status.total > 0;
  return (
    <li className="cs-unit">
      <div>
        <Link
          to="/courses/$courseId/$unit"
          params={{ courseId, unit: String(unit.n) }}
          className="cs-unit-title"
        >
          {unit.title}
        </Link>
        <p className="cs-meta">
          pages {unit.pages[0]}–{unit.pages[1]}
          {status.exercisesTotal > 0
            ? ` · ${status.exercisesDone} of ${status.exercisesTotal} exercises done`
            : ""}
        </p>
      </div>
      <div>
        {hasWords ? (
          <>
            <CoverageMeter value={status.knownRatio} block hideValue label="Words known" />
            <p className="cs-meta">
              {pct(status.knownRatio)} known · {status.learning} learning ·{" "}
              {status.newInAnki + status.missing} new
            </p>
          </>
        ) : (
          <p className="cs-meta">No word list</p>
        )}
      </div>
      <Link
        to="/courses/$courseId/$unit"
        params={{ courseId, unit: String(unit.n) }}
        className="k-btn k-btn--secondary k-btn--sm"
      >
        Open
      </Link>
    </li>
  );
}

/** One course: its units with progress, and the way back to the outline editor. */
export function CourseRoute({ courseId }: { courseId: string }) {
  const services = useServices();
  const native = useNativeMode();
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const course = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => services.course(courseId),
  });
  if (course.isPending) {
    return (
      <div className="page">
        <Skeleton style={{ height: 120, borderRadius: 10 }} />
      </div>
    );
  }
  if (course.isError || !course.data) {
    return (
      <div className="page">
        <PageHeader
          title="Course not found"
          lede={<Link to="/courses">Back to your courses</Link>}
        />
      </div>
    );
  }
  const { units, course: c, ankiReady } = course.data;
  const missing = units.reduce((n, r) => n + r.status.missing, 0);
  const next = units.find(
    (r) =>
      r.unit.kind === "theme" &&
      (r.status.exercisesDone < r.status.exercisesTotal ||
        (r.status.total > 0 && r.status.knownRatio < 1)),
  );
  return (
    <div className="page">
      <PageHeader
        title={c.title}
        lede={
          <>
            Progress is the state of each unit&rsquo;s words in your Anki decks, plus the exercises
            you have done.
          </>
        }
        actions={
          <>
            {next ? (
              <Link
                to="/courses/$courseId/$unit"
                params={{ courseId, unit: String(next.unit.n) }}
                className="k-btn k-btn--primary"
              >
                Continue with {next.unit.title}
              </Link>
            ) : null}
            {missing > 0 ? (
              <Button onClick={() => setAdding(true)}>
                Add all course words{native ? "" : " to Anki"}…
              </Button>
            ) : null}
            <Link to="/courses/$courseId/edit" params={{ courseId }} className="k-btn k-btn--ghost">
              Edit outline
            </Link>
            <Button variant="ghost" onClick={() => setExporting(true)}>
              Export course pack…
            </Button>
          </>
        }
      />
      {!ankiReady ? (
        <div className="banner" role="note">
          <span>Sync Anki in Settings to see how much of each unit you already know.</span>
        </div>
      ) : null}
      {adding ? (
        <AddWordsDialog courseId={courseId} scope="all" open={adding} onOpenChange={setAdding} />
      ) : null}
      {exporting ? (
        <ExportPackDialog courseId={courseId} open={exporting} onOpenChange={setExporting} />
      ) : null}
      <ul className="cs-list" style={{ gap: 0 }}>
        {units.map((row) => (
          <UnitLine key={row.unit.n} courseId={courseId} row={row} />
        ))}
      </ul>
    </div>
  );
}
