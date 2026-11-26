import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "./cn.js";

interface FieldShellProps {
  label?: string;
  hint?: string;
  /** What the field needs (SY8): it turns red, shakes once and says so right under it. */
  error?: string | null | undefined;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    <div className="k-field" {...(error ? { "data-error": "" } : {})}>
      {label ? (
        <label className="k-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="k-field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="k-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldShellProps;

/** Single-line text input with optional label and hint. */
export function Input({ label, hint, error, className, id, ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} {...(label ? { label } : {})} {...(hint ? { hint } : {})} error={error}>
      <input
        id={fid}
        className={cn("k-input", className)}
        {...(error ? { "aria-invalid": true, "aria-describedby": `${fid}-error` } : {})}
        {...rest}
      />
    </FieldShell>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShellProps;

/** Multi-line text input with optional label and hint. */
export function Textarea({ label, hint, error, className, id, ...rest }: TextareaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} {...(label ? { label } : {})} {...(hint ? { hint } : {})} error={error}>
      <textarea
        id={fid}
        className={cn("k-textarea", className)}
        {...(error ? { "aria-invalid": true, "aria-describedby": `${fid}-error` } : {})}
        {...rest}
      />
    </FieldShell>
  );
}
