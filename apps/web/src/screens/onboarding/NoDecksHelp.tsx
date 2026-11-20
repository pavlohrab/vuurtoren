import { Link } from "@tanstack/react-router";

/**
 * Shown instead of "No nl vocabulary decks found": Vuurtoren has no decks to read yet, which is
 * fine. Points to onboarding and to Settings → Language & decks.
 */
export function NoDecksHelp() {
  return (
    <div className="ob-note stack" role="status" style={{ gap: 6 }}>
      <strong>Vuurtoren has no Dutch decks to read yet.</strong>
      <span>
        Choose the Anki decks that hold your Dutch words, or start fresh: Vuurtoren then creates
        Vuurtoren::Nederlands and fills it as you add words while reading.
      </span>
      <span>
        <Link to="/welcome">Set up decks step by step</Link> · or choose them under Language &amp;
        decks above.
      </span>
    </div>
  );
}
