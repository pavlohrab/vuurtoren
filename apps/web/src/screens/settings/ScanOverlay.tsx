/**
 * The QR scanner's frame on a phone. The camera runs behind a see-through page (the scanner's
 * windowed mode), so while it is open the app hides everything else and draws a square to put
 * the code in, a short hint and Cancel. The square is a hole in a dark layer; its corners are
 * marked in the accent colour.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@app/ui";
import { useBackClose } from "../../shell/backStack.js";

export function ScanOverlay({ onCancel }: { onCancel: () => void }) {
  useEffect(() => {
    document.documentElement.dataset["scanning"] = "";
    return () => {
      delete document.documentElement.dataset["scanning"];
    };
  }, []);
  // Android Back cancels the scan, as Cancel does.
  useBackClose(true, onCancel);
  return createPortal(
    <div className="scan" role="dialog" aria-modal="true" aria-labelledby="scan-title">
      <p className="scan-title" id="scan-title">
        Scan the QR code
      </p>
      <div className="scan-frame" aria-hidden>
        <span className="scan-corner scan-corner--tl" />
        <span className="scan-corner scan-corner--tr" />
        <span className="scan-corner scan-corner--bl" />
        <span className="scan-corner scan-corner--br" />
      </div>
      <p className="scan-hint">
        On your server, open Settings → Your devices → Add a phone, and fit its code in the square.
      </p>
      <Button className="scan-cancel" onClick={onCancel}>
        Cancel
      </Button>
    </div>,
    document.body,
  );
}
