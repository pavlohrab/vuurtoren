import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "./cn.js";

interface FieldShellProps {
  label?: string;
  hint?: string;
}

function FieldShell({
  id,
  label,
  hint,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    <div className="k-field">
      {label ? (
        <label className="k-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <span className="k-hint">{hint}</span> : null}
    </div>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldShellProps;

/** Single-line text input with optional label and hint. */
export function Input({ label, hint, className, id, ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} {...(label ? { label } : {})} {...(hint ? { hint } : {})}>
      <input id={fid} className={cn("k-input", className)} {...rest} />
    </FieldShell>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShellProps;

/** Multi-line text input with optional label and hint. */
export function Textarea({ label, hint, className, id, ...rest }: TextareaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} {...(label ? { label } : {})} {...(hint ? { hint } : {})}>
      <textarea id={fid} className={cn("k-textarea", className)} {...rest} />
    </FieldShell>
  );
}
