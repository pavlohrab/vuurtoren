import * as RTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export interface TabItem {
  value: string;
  label: string;
  /** A shorter label for narrow screens (below 900px); the tab's name stays `label`. */
  short?: string;
  /** Panel content; omit to use the tabs purely as a segmented control. */
  content?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  "aria-label"?: string;
}

/** Tabs (Radix) rendered as a quiet segmented control. */
export function Tabs({ items, value, onValueChange, "aria-label": ariaLabel }: TabsProps) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className="k-tabs-list" aria-label={ariaLabel}>
        {items.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="k-tabs-trigger"
            {...(t.short ? { "aria-label": t.label } : {})}
          >
            {t.short ? (
              <>
                <span className="k-tabs-long">{t.label}</span>
                <span className="k-tabs-short" aria-hidden>
                  {t.short}
                </span>
              </>
            ) : (
              t.label
            )}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {items.map((t) =>
        t.content !== undefined ? (
          <RTabs.Content key={t.value} value={t.value} className="k-tabs-content">
            {t.content}
          </RTabs.Content>
        ) : null,
      )}
    </RTabs.Root>
  );
}
