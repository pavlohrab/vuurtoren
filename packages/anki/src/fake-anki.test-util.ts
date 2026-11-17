/** In-memory AnkiConnect fake for tests (legacy actions; v1 answers 404). */
export interface FakeNote {
  id: number;
  deck: string;
  model: string;
  fields: Record<string, string>;
  /** One entry per card: interval days (0 = new, negative = learning seconds). */
  cards: number[];
  lastReview?: number;
}

export function fakeAnki(
  notes: FakeNote[],
  log: { action: string; params: unknown }[] = [],
): typeof fetch {
  const cardOf = new Map<number, { note: FakeNote; ivl: number }>();
  for (const n of notes) n.cards.forEach((ivl, j) => cardOf.set(n.id * 10 + j, { note: n, ivl }));
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/api/v1")) return new Response("{}", { status: 404 });
    const { action, params } = JSON.parse(String(init?.body)) as {
      action: string;
      params: Record<string, unknown>;
    };
    log.push({ action, params });
    let result: unknown = null;
    let error: string | null = null;
    switch (action) {
      case "deckNames":
        result = [...new Set(notes.map((n) => n.deck))];
        break;
      case "findNotes": {
        const q = String(params["query"]);
        const deck = /"deck:((?:\\.|[^"\\])*)"/.exec(q)?.[1]?.replace(/\\(.)/g, "$1");
        const model = /"note:((?:\\.|[^"\\])*)"/.exec(q)?.[1]?.replace(/\\(.)/g, "$1");
        result = notes
          .filter((n) => (!deck || n.deck === deck) && (!model || n.model === model))
          .map((n) => n.id);
        break;
      }
      case "notesInfo":
        result = (params["notes"] as number[]).map((id) => {
          const n = notes.find((x) => x.id === id)!;
          return {
            noteId: id,
            modelName: n.model,
            tags: [],
            fields: Object.fromEntries(
              Object.entries(n.fields).map(([k, v], order) => [k, { value: v, order }]),
            ),
            cards: n.cards.map((_, j) => id * 10 + j),
          };
        });
        break;
      case "cardsInfo":
        result = (params["cards"] as number[]).map((cardId) => {
          const c = cardOf.get(cardId)!;
          return {
            cardId,
            note: c.note.id,
            deckName: c.note.deck,
            modelName: c.note.model,
            interval: c.ivl,
            type: c.ivl === 0 ? 0 : c.ivl < 0 ? 1 : 2,
            queue: 2,
            reps: 1,
            lapses: 0,
          };
        });
        break;
      case "getReviewsOfCards":
        result = Object.fromEntries(
          (params["cards"] as string[]).map((id) => {
            const c = cardOf.get(Number(id));
            return [id, c?.note.lastReview ? [{ id: c.note.lastReview }] : []];
          }),
        );
        break;
      default:
        error = `unsupported action ${action}`;
    }
    return new Response(JSON.stringify({ result, error }));
  }) as typeof fetch;
}
