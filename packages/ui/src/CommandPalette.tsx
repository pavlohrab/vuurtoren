import { Command } from "cmdk";
import * as RDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export interface CommandEntry {
  id: string;
  label: string;
  /** Extra search terms. */
  keywords?: string[];
  icon?: ReactNode;
  onSelect: () => void;
}

export interface CommandGroup {
  heading: string;
  entries: CommandEntry[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandGroup[];
  placeholder?: string;
}

/** Command palette (cmdk) shown in a modal. Selecting an entry runs it and closes the palette. */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  placeholder = "Search pages and texts",
}: CommandPaletteProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="k-overlay" />
        <RDialog.Content className="k-command" aria-describedby={undefined}>
          <RDialog.Title style={{ position: "absolute", left: -9999 }}>
            Command palette
          </RDialog.Title>
          <Command label="Command palette" loop>
            <Command.Input className="k-command-input" placeholder={placeholder} autoFocus />
            <Command.List className="k-command-list">
              <Command.Empty className="k-command-empty">Nothing matches.</Command.Empty>
              {groups.map((g) => (
                <Command.Group key={g.heading} heading={g.heading} className="k-command-group">
                  {g.entries.map((e) => (
                    <Command.Item
                      key={e.id}
                      // cmdk identifies items by `value`: use the unique id so two entries with
                      // the same label (e.g. two texts titled alike) never collide.
                      value={e.id}
                      keywords={[e.label, ...(e.keywords ?? [])]}
                      className="k-command-item"
                      onSelect={() => {
                        onOpenChange(false);
                        e.onSelect();
                      }}
                    >
                      {e.icon}
                      {e.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
