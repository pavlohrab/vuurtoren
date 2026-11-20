/** Pieces used by more than one Settings screen. */
import { useState } from "react";
import { Button } from "@app/ui";

/** The self-hosting guide on GitHub. */
export const SELF_HOSTING_URL = "https://github.com/pavlohrab/Kenning/blob/main/deploy/README.md";

/** A labelled block of text with a Copy button (a command, a token, a key). */
export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{label}</strong>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="mcp-command" aria-label={label}>
        {text}
      </pre>
    </div>
  );
}
