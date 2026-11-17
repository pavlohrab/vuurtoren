import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "accent" | "warm" | "success";
}

/** Small pill label. */
export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return (
    <span className={cn("k-chip", tone !== "neutral" && `k-chip--${tone}`, className)} {...rest} />
  );
}
