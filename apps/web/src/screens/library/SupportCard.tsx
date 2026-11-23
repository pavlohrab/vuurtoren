/**
 * A quiet card on the Read home asking for support, shown by the rules in `support.ts`. Never a
 * pop-up, never during a review or while reading. Support and Not now both put it away until
 * the next ask; Don't ask again is final (the menu keeps its Support button).
 */
import { Heart } from "lucide-react";
import { useState } from "react";
import { Button } from "@app/ui";
import { SUPPORT_URL, readSupport, shouldAsk, writeSupport } from "../../support.js";
import "./today.css";

export function SupportCard() {
  const [show, setShow] = useState(() => shouldAsk(readSupport()));
  if (!show) return null;

  const answer = (never: boolean) => {
    const state = readSupport();
    writeSupport(never ? { ...state, never: true } : { ...state, askedAt: state.days });
    setShow(false);
  };

  return (
    <aside className="support-card" aria-labelledby="support-card-h">
      <Heart size={18} className="support-card-icon" aria-hidden />
      <div className="support-card-text">
        <h2 id="support-card-h" className="support-card-title">
          Vuurtoren is made by one person.
        </h2>
        <p className="support-card-hint">If it helps you, you can support it.</p>
      </div>
      <div className="support-card-actions">
        <a
          className="k-btn k-btn--primary"
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          onClick={() => answer(false)}
        >
          Support
        </a>
        <Button variant="ghost" onClick={() => answer(false)}>
          Not now
        </Button>
        <Button variant="ghost" onClick={() => answer(true)}>
          Don't ask again
        </Button>
      </div>
    </aside>
  );
}
