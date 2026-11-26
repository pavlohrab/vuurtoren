import { Link } from "@tanstack/react-router";
import type { SettingsPlace } from "../services/errors.js";

/**
 * A button to the Settings section where something is fixed (SY8): a message says where to go
 * and has this next to it, never "in Settings" in words alone.
 */
export function SettingsButton({ go, primary = false }: { go: SettingsPlace; primary?: boolean }) {
  return (
    <Link
      to="/settings"
      search={{ section: go.section }}
      className={`k-btn ${primary ? "k-btn--primary" : "k-btn--secondary"} k-btn--sm`}
    >
      {go.label} →
    </Link>
  );
}
