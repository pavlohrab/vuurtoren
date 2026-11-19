import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@app/ui";
import {
  type CourseReviewPage,
  type ReviewState,
  type TextEdit,
  acceptAllSuggestions,
  initReview,
  openCount,
  reviewEdits,
  suggestionCount,
} from "../../services/ocrReview.js";
import { OcrReview } from "../ocr/OcrReview.js";

interface Props {
  pages: CourseReviewPage[];
  /** The fixes per page number, or null to keep the text as recognised. */
  onDone: (edits: Map<number, TextEdit[]> | null) => void;
}

/** The "Check" step of a course import: the flagged pages, one at a time. */
export function CourseReview({ pages, onDone }: Props) {
  const [states, setStates] = useState<ReviewState[]>(() =>
    pages.map((p) => initReview(p.text, p.flags)),
  );
  const [at, setAt] = useState(0);
  // Page pictures load when a page is first shown (object URLs, freed on leaving).
  const [images, setImages] = useState<Record<number, string | null>>({});
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const page = pages[at];
  useEffect(() => {
    if (!page?.image || page.n in images) return;
    let live = true;
    void page.image().then((src) => {
      if (src) urls.current.push(src);
      if (live) setImages((m) => ({ ...m, [page.n]: src }));
    });
    return () => {
      live = false;
    };
  }, [page, images]);

  const state = states[at];
  if (!page || !state) return null;
  const words = states.reduce((n, s) => n + openCount(s), 0);
  const withSuggestions = states.reduce((n, s) => n + suggestionCount(s), 0);
  const finish = () => {
    const out = new Map<number, TextEdit[]>();
    states.forEach((s, i) => {
      const edits = reviewEdits(s);
      const n = pages[i]?.n;
      if (edits.length > 0 && n !== undefined) out.set(n, edits);
    });
    onDone(out);
  };

  return (
    <div className="stack">
      <p className="page-lede" style={{ margin: 0 }}>
        {words === 0
          ? "Every flagged word is checked."
          : `${words} ${words === 1 ? "word" : "words"} on ${pages.length} ${
              pages.length === 1 ? "page" : "pages"
            } may be misread. Check the pages that matter to you, or skip this step.`}
      </p>
      <OcrReview
        value={state}
        onChange={(next) => setStates((all) => all.map((s, i) => (i === at ? next : s)))}
        image={() => {
          if (!page.image) return null;
          const src = images[page.n];
          return src === undefined ? undefined : src === null ? null : { src };
        }}
        label={
          <span className="cs-review-pages">
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label="Previous page"
              disabled={at === 0}
              onClick={() => setAt(at - 1)}
            >
              <ChevronLeft size={16} aria-hidden />
            </Button>
            Page {page.n}
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label="Next page"
              disabled={at === pages.length - 1}
              onClick={() => setAt(at + 1)}
            >
              <ChevronRight size={16} aria-hidden />
            </Button>
            <span aria-hidden>·</span>{" "}
          </span>
        }
        actions={
          <>
            {withSuggestions > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStates((all) => all.map(acceptAllSuggestions))}
              >
                Accept all suggestions
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
              Skip review
            </Button>
            <Button size="sm" variant="primary" onClick={finish}>
              Continue
            </Button>
          </>
        }
      />
    </div>
  );
}
