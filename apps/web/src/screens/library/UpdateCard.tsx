/**
 * A quiet card on Read when a newer Android app is on GitHub (TR12, `updates.ts`). Download
 * opens the release page; Not now hides it until the next version.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";
import { Button } from "@app/ui";
import {
  RELEASES_PAGE,
  checksForUpdates,
  newVersion,
  readUpdates,
  writeUpdates,
} from "../../updates.js";
import { APP_VERSION } from "../../version.js";
import "./today.css";

export function UpdateCard() {
  const [hidden, setHidden] = useState(false);
  const check = checksForUpdates();
  const latest = useQuery({
    queryKey: ["app-update"],
    queryFn: () => newVersion(),
    enabled: check,
    staleTime: Infinity,
  });
  const version = latest.data;
  if (!check || hidden || !version) return null;

  const notNow = () => {
    writeUpdates({ ...readUpdates(), dismissed: version });
    setHidden(true);
  };

  return (
    <aside className="support-card" aria-labelledby="update-card-h">
      <ArrowDownToLine size={18} className="support-card-icon" aria-hidden />
      <div className="support-card-text">
        <h2 id="update-card-h" className="support-card-title">
          Vuurtoren {version} is out.
        </h2>
        <p className="support-card-hint">You have {APP_VERSION}.</p>
      </div>
      <div className="support-card-actions">
        <a
          className="k-btn k-btn--primary"
          href={RELEASES_PAGE}
          target="_blank"
          rel="noreferrer"
          onClick={notNow}
        >
          Download
        </a>
        <Button variant="ghost" onClick={notNow}>
          Not now
        </Button>
      </div>
    </aside>
  );
}

/** Settings: the check can be turned off (only where it runs). */
export function UpdateSetting() {
  const [off, setOff] = useState(() => readUpdates().off === true);
  if (!checksForUpdates()) return null;
  return (
    <label className="settings-check">
      <input
        type="checkbox"
        checked={!off}
        onChange={(e) => {
          writeUpdates({ ...readUpdates(), off: !e.target.checked });
          setOff(!e.target.checked);
        }}
      />
      <span>
        Tell me about new versions
        <small>Once a day the app asks GitHub for the newest version.</small>
      </span>
    </label>
  );
}
