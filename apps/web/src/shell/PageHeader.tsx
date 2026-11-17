import type { ReactNode } from "react";

/**
 * The one page header: the title (the page's h1), one line on what the page is for, and the
 * primary action on the right. Library, Practice, Words, Courses, Grammar, Talk and Settings
 * all use it, so their edges and baselines line up.
 */
export function PageHeader({
  title,
  lede,
  actions,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <h1 className="page-title">{title}</h1>
      {actions ? (
        <div className="page-actions" role="group" aria-label="Page actions">
          {actions}
        </div>
      ) : null}
      {lede ? <p className="page-lede">{lede}</p> : null}
    </header>
  );
}
