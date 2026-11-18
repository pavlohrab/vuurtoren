import * as RDialog from "@radix-ui/react-dialog";
import * as RPopover from "@radix-ui/react-popover";
import * as RTooltip from "@radix-ui/react-tooltip";
import { type ReactNode, useRef } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
}

/** Modal dialog with focus trap, Esc to close and a required accessible title. */
export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="k-overlay" />
        <RDialog.Content
          className="k-dialog"
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <RDialog.Title className="k-dialog-title">{title}</RDialog.Title>
          {description ? (
            <RDialog.Description className="k-dialog-desc">{description}</RDialog.Description>
          ) : null}
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name of the popover content. */
  label?: string;
  className?: string;
}

/** Popover anchored to a trigger element (the trigger must accept a ref and props). */
export function Popover({
  trigger,
  children,
  align = "start",
  open,
  onOpenChange,
  label,
  className,
}: PopoverProps) {
  return (
    <RPopover.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          className={className ? `k-popover ${className}` : "k-popover"}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          {...(label ? { "aria-label": label } : {})}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export interface AnchoredPopoverProps {
  /** Element to place the popover next to (e.g. a margin mark); null closes it. */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Accessible name of the popover (it is a non-modal dialog). */
  label: string;
  /**
   * Where to place the popover, when not next to `anchor` itself (e.g. under the line of the
   * words it explains). `anchor` still gets the focus back after Esc.
   */
  measure?: () => DOMRect;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  children: ReactNode;
}

/**
 * A popover opened by the app (not by a trigger it owns), placed next to `anchor`. Esc and
 * outside clicks close it, and focus goes back to the anchor.
 */
export function AnchoredPopover({
  anchor,
  onClose,
  label,
  measure,
  side = "right",
  align = "start",
  className,
  children,
}: AnchoredPopoverProps) {
  const ref = { current: measure ? { getBoundingClientRect: measure } : anchor };
  const escaped = useRef(false);
  // The anchor is already null when the popover finishes closing: keep the last one.
  const last = useRef<HTMLElement | null>(null);
  if (anchor) last.current = anchor;
  return (
    <RPopover.Root open={anchor !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {anchor ? (
        <RPopover.Anchor
          virtualRef={ref as { current: { getBoundingClientRect: () => DOMRect } }}
        />
      ) : null}
      <RPopover.Portal>
        <RPopover.Content
          className={className ? `k-popover ${className}` : "k-popover"}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          onEscapeKeyDown={() => {
            escaped.current = true;
          }}
          onCloseAutoFocus={(e) => {
            // Back to the anchor after Esc; a click elsewhere keeps its own focus.
            e.preventDefault();
            if (escaped.current) last.current?.focus();
            escaped.current = false;
          }}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/** Wrap the app once so tooltips share their open delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={300}>{children}</RTooltip.Provider>;
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

/** Tooltip around a focusable child. Requires a TooltipProvider ancestor. */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="k-tooltip" side={side} sideOffset={6}>
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
