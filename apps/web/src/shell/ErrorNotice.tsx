import { Link } from "@tanstack/react-router";
import { Button } from "@app/ui";
import { describeError } from "../services/errors.js";

interface ErrorNoticeProps {
  error: unknown;
  /** Shown when the error has no plain message of its own. */
  fallback?: string;
  /** Prefix such as "The import did not work." */
  title?: string;
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  /** Offer "Open Settings" for Anki and language-server errors (off on the Settings page). */
  settingsLink?: boolean;
}

/** A plain error: cause, next step, Retry, a Settings link when it helps, details on demand. */
export function ErrorNotice({
  error,
  fallback,
  title,
  onRetry,
  retryLabel = "Retry",
  settingsLink = true,
}: ErrorNoticeProps) {
  const f = describeError(error, fallback);
  const settings = settingsLink && (f.go || f.source === "nlp" || f.source === "anki");
  return (
    <div className="error-notice" role="alert">
      <p className="error-notice-message">
        {title ? <strong>{title} </strong> : null}
        {f.message}
      </p>
      {f.next ? <p className="error-notice-next">{f.next}</p> : null}
      {onRetry || settings ? (
        <div className="row">
          {onRetry ? (
            <Button size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {settings ? (
            <Link
              to="/settings"
              {...(f.go ? { search: { section: f.go.section } } : {})}
              className="k-btn k-btn--secondary k-btn--sm"
            >
              {f.go ? `${f.go.label} →` : "Open Settings"}
            </Link>
          ) : null}
        </div>
      ) : null}
      {f.details ? (
        <details className="error-notice-details">
          <summary>Technical details</summary>
          <code>{f.details}</code>
        </details>
      ) : null}
    </div>
  );
}
