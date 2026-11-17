import { retrievability } from "@app/core";

/** Placeholder until the M2 app shell; proves the core package is wired in. */
export function App() {
  const r = retrievability(10, 10);
  return (
    <main
      style={{ fontFamily: "system-ui", maxWidth: "66ch", margin: "4rem auto", padding: "0 16px" }}
    >
      <h1>Kenning</h1>
      <p>Your Anki deck, turned into a reading and speaking coach.</p>
      <p style={{ color: "#6B6259" }}>Core wired: R(S) = {r.toFixed(2)}</p>
    </main>
  );
}
