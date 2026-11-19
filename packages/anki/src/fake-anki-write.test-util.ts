/**
 * In-memory AnkiConnect fake that supports the write actions (legacy + the v1 reposition call).
 * Tests only: the real collection must never be written by tests.
 */
export interface FakeCard {
  id: number;
  note: number;
  deck: string;
  /** 0 new, 1 learning, 2 review, 3 relearning */
  type: number;
  /** -1 suspended, -2/-3 buried, 0 new, 1 learning, 2 review */
  queue: number;
  interval: number;
  /** New cards: position; review cards: days until due (relative to today). */
  due: number;
}

export interface FakeCollection {
  cards: FakeCard[];
  tags: Map<number, Set<string>>;
  /** Every request as `{ action | method, params }`, in order. */
  log: { action: string; params: unknown }[];
  models: Set<string>;
  decks: Set<string>;
  notes: Map<number, { deck: string; model: string; fields: Record<string, string> }>;
  nextId: number;
  /** Rows written by insertReviews: [id, cid, usn, ease, ivl, lastIvl, factor, time, type]. */
  revlog?: number[][];
  /** Card values set with setSpecificValueOfCard (other than ivl), by "cardId:key". */
  values?: Map<string, number>;
}

export interface FakeOptions {
  /** Answer the v1 JSON-RPC endpoint (default true). When false it returns 404. */
  v1?: boolean;
  /** Make the named actions/methods fail with this message. */
  failing?: Record<string, string>;
}

/** Build a collection from cards; one note per distinct `note` id. */
export function fakeCollection(cards: FakeCard[]): FakeCollection {
  const notes: FakeCollection["notes"] = new Map();
  for (const c of cards) {
    if (!notes.has(c.note)) notes.set(c.note, { deck: c.deck, model: "Basic", fields: {} });
  }
  return {
    cards,
    tags: new Map(),
    log: [],
    models: new Set(),
    decks: new Set(cards.map((c) => c.deck)),
    notes,
    nextId: 9000,
  };
}

/** Parse `cid:1,2 prop:due=3` style queries used by the due-text probe. */
function findCards(col: FakeCollection, query: string): number[] {
  const cid = /cid:([\d,]+)/.exec(query)?.[1]?.split(",").map(Number);
  const prop = /prop:due(<=|>=|=|<|>)(-?\d+)/.exec(query);
  return col.cards
    .filter((c) => !cid || cid.includes(c.id))
    .filter((c) => {
      if (!prop) return true;
      const n = Number(prop[2]);
      switch (prop[1]) {
        case "=":
          return c.due === n;
        case "<=":
          return c.due <= n;
        case ">":
          return c.due > n;
        default:
          return false;
      }
    })
    .map((c) => c.id);
}

/** Legacy `setDueDate` with "a-b!" : set the interval to a (cards become review cards). */
function applyDueDate(c: FakeCard, days: string): void {
  const m = /^(\d+)(?:-(\d+))?(!)?$/.exec(days);
  if (!m) throw new Error(`bad days ${days}`);
  const lo = Number(m[1]);
  c.type = 2;
  c.queue = 2;
  if (m[3]) c.interval = lo;
  c.due = lo;
}

function legacy(
  col: FakeCollection,
  action: string,
  params: Record<string, unknown>,
  failing: Record<string, string> = {},
): unknown {
  switch (action) {
    case "version":
      return 6;
    case "modelNames":
      return [...col.models];
    case "createModel":
      col.models.add(String(params["modelName"]));
      return null;
    case "createDeck":
      col.decks.add(String(params["deck"]));
      return 1;
    case "findNotes": {
      const q = String(params["query"]);
      const word = /"Word:((?:\\.|[^"\\])*)"/.exec(q)?.[1]?.replace(/\\(.)/g, "$1");
      return [...col.notes].filter(([, n]) => !word || n.fields["Word"] === word).map(([id]) => id);
    }
    case "findCards":
      return findCards(col, String(params["query"]));
    case "multi":
      // Like AnkiConnect: an action sent with version 5 or later answers `{ result, error }`,
      // an older one the plain value (and `{ result: null, error }` when it fails).
      return (
        params["actions"] as {
          action: string;
          version?: number;
          params?: Record<string, unknown>;
        }[]
      ).map((a) => {
        col.log.push({ action: a.action, params: a.params });
        try {
          const fail = failing[a.action];
          if (fail) throw new Error(fail);
          const result = legacy(col, a.action, a.params ?? {}, failing);
          return (a.version ?? 4) >= 5 ? { result, error: null } : result;
        } catch (e) {
          return { result: null, error: (e as Error).message };
        }
      });
    case "suspend":
      for (const c of col.cards) if ((params["cards"] as number[]).includes(c.id)) c.queue = -1;
      return true;
    case "setSpecificValueOfCard": {
      const c = col.cards.find((x) => x.id === params["card"]);
      if (!c) throw new Error("card not found");
      const keys = params["keys"] as string[];
      const values = params["newValues"] as number[];
      keys.forEach((k, i) => {
        if (k === "ivl") c.interval = values[i]!;
        else (col.values ??= new Map()).set(`${c.id}:${k}`, values[i]!);
      });
      return keys.map(() => true);
    }
    case "insertReviews":
      for (const r of params["reviews"] as number[][]) (col.revlog ??= []).push(r);
      return null;
    case "getReviewsOfCards": {
      const out: Record<string, { id: number }[]> = {};
      for (const id of params["cards"] as string[]) {
        out[id] = (col.revlog ?? []).filter((r) => r[1] === Number(id)).map((r) => ({ id: r[0]! }));
      }
      return out;
    }
    case "addNote": {
      const n = params["note"] as {
        deckName: string;
        modelName: string;
        fields: Record<string, string>;
        tags: string[];
      };
      for (const e of col.notes.values())
        if (e.deck === n.deckName && e.fields["Word"] === n.fields["Word"])
          throw new Error("cannot create note because it is a duplicate");
      const id = col.nextId++;
      col.notes.set(id, { deck: n.deckName, model: n.modelName, fields: n.fields });
      col.tags.set(id, new Set(n.tags));
      col.cards.push({
        id: id * 10,
        note: id,
        deck: n.deckName,
        type: 0,
        queue: 0,
        interval: 0,
        due: 1000,
      });
      return id;
    }
    case "notesInfo":
      return (params["notes"] as number[]).map((id) => {
        const n = col.notes.get(id);
        if (!n) return {};
        return {
          noteId: id,
          modelName: n.model,
          tags: [...(col.tags.get(id) ?? [])],
          fields: {},
          cards: col.cards.filter((c) => c.note === id).map((c) => c.id),
        };
      });
    case "cardsInfo":
      return (params["cards"] as number[]).map((id) => {
        const c = col.cards.find((x) => x.id === id);
        if (!c) return {};
        return {
          cardId: c.id,
          note: c.note,
          deckName: c.deck,
          modelName: "Basic",
          interval: c.interval,
          type: c.type,
          queue: c.queue,
          due: c.due,
          reps: 0,
          lapses: 0,
        };
      });
    case "addTags":
      for (const id of params["notes"] as number[]) {
        const set = col.tags.get(id) ?? new Set<string>();
        for (const t of String(params["tags"]).split(" ")) set.add(t);
        col.tags.set(id, set);
      }
      return null;
    case "unsuspend":
      for (const c of col.cards)
        if ((params["cards"] as number[]).includes(c.id) && c.queue === -1)
          c.queue = c.type === 0 ? 0 : c.type === 2 ? 2 : 1;
      return true;
    case "setDueDate":
      for (const c of col.cards)
        if ((params["cards"] as number[]).includes(c.id)) applyDueDate(c, String(params["days"]));
      return true;
    default:
      throw new Error(`unsupported action ${action}`);
  }
}

/** A `fetch` that behaves like AnkiConnect over `col`. */
export function fakeAnkiWrite(col: FakeCollection, opts: FakeOptions = {}): typeof fetch {
  const v1 = opts.v1 ?? true;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(url).endsWith("/api/v1")) {
      if (!v1) return new Response("{}", { status: 404 });
      const { method, params, id } = body as {
        method: string;
        params: Record<string, unknown>;
        id: number;
      };
      col.log.push({ action: method, params });
      const fail = opts.failing?.[method];
      if (fail) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id, error: { code: 1, message: fail } }),
        );
      }
      let result: unknown;
      if (method === "api.describe") result = { apiMajor: 1 };
      else if (method === "scheduling.repositionNewCards") {
        const ids = (params["cardIds"] as string[]).map(Number);
        let pos = params["startingFrom"] as number;
        for (const c of col.cards) if (ids.includes(c.id)) c.due = pos++;
        result = { changedCount: ids.length };
      } else {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "no such method" },
          }),
        );
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
    }
    const { action, params } = body as { action: string; params: Record<string, unknown> };
    col.log.push({ action, params });
    const fail = opts.failing?.[action];
    if (fail) return new Response(JSON.stringify({ result: null, error: fail }));
    try {
      return new Response(
        JSON.stringify({
          result: legacy(col, action, params ?? {}, opts.failing),
          error: null,
        }),
      );
    } catch (e) {
      return new Response(JSON.stringify({ result: null, error: (e as Error).message }));
    }
  }) as typeof fetch;
}
