import { useState } from "react";
import { Button } from "@app/ui";
import { desktopBridge } from "./bridge.js";

/** Settings > Account in the desktop app: which server this window shows, and a way out. */
export function DesktopServer() {
  const bridge = desktopBridge();
  const [error, setError] = useState<string | null>(null);
  if (!bridge || bridge.home) return null;
  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <p style={{ margin: 0 }}>
        Desktop app, connected to <strong>{location.host}</strong>.
      </p>
      <div className="row">
        <Button
          onClick={() => void bridge.changeServer().catch((e: unknown) => setError(String(e)))}
        >
          Change server…
        </Button>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
