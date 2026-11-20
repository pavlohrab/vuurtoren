/**
 * A minimal AnkiConnect (http://127.0.0.1:8765) for the browser-storage run: it accepts new
 * notes, so "Add to Anki" works and the word becomes one to practise.
 */
import type { Page, Route } from "@playwright/test";

export async function fakeAnki(page: Page): Promise<void> {
  let nextId = 1_700_000_000_000;
  const notes: number[] = [];
  const handle = async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "POST, OPTIONS",
        },
      });
    }
    const { action } = req.postDataJSON() as { action: string };
    const results: Record<string, unknown> = {
      version: 6,
      requestPermission: { permission: "granted", requireApikey: false, version: 6 },
      deckNames: ["Default"],
      createDeck: 1,
      modelNames: ["Basic", "Vuurtoren"],
      modelFieldNames: ["Word", "Gloss", "Sentence", "SentenceTranslation", "Source"],
      findNotes: [],
      findCards: [],
      notesInfo: [],
      cardsInfo: [],
      multi: [],
    };
    let result: unknown = results[action] ?? null;
    if (action === "addNote") {
      result = nextId++;
      notes.push(result as number);
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ result, error: null }),
    });
  };
  await page.route("http://127.0.0.1:8765/**", handle);
  await page.route("http://127.0.0.1:8765", handle);
}
