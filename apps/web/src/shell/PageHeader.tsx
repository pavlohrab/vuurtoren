import type { ReactNode } from "react";

/**
 * The one page header (design-system.md, Page header): the title (the page's h1), one line on
 * what the page is for, and the actions on the right (at most one primary). Sub-pages pass a
 * `back` link that sits above the title. Every top-level screen uses it, Home included, so
 * edges and baselines line up.
 */
export function PageHeader({
  title,
  lede,
  actions,
  back,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="page-head">
      {back ? <div className="page-back">{back}</div> : null}
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

/**
 * The one section header (design-system.md, Section header): an h2 and an optional quiet link
 * on the right. Wrap the section in `<section className="k-section" aria-labelledby={id}>`.
 */
export function SectionHeader({
  id,
  title,
  action,
}: {
  id: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="k-section-head">
      <h2 className="k-section-title" id={id}>
        {title}
      </h2>
      {action}
    </header>
  );
}
