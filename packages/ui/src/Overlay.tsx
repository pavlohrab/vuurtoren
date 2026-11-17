import * as RDialog from "@radix-ui/react-dialog";
import * as RPopover from "@radix-ui/react-popover";
import * as RTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

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
}

/** Popover anchored to a trigger element (the trigger must accept a ref and props). */
export function Popover({ trigger, children, align = "start" }: PopoverProps) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className="k-popover" align={align} sideOffset={6}>
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
