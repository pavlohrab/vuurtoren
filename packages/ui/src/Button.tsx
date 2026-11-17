import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  /** Square icon-only button; pass an aria-label. */
  icon?: boolean;
}

/** Button with primary / secondary / ghost variants. Focus ring comes from the global :focus-visible rule. */
export function Button({
  variant = "secondary",
  size = "md",
  icon = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "k-btn",
        `k-btn--${variant}`,
        size === "sm" && "k-btn--sm",
        icon && "k-btn--icon",
        className,
      )}
      {...rest}
    />
  );
}
