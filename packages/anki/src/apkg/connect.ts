/**
 * Reading chosen decks straight from Anki through AnkiConnect, in the same shape as a package
 * file: note types, deck options, notes, cards, the full review log and the media the notes use.
 * Read-only.
 */
import { DEFAULT_DECK_OPTIONS, type DeckOptions } from "@app/core";
import { type AnkiConnectClient, exactDeckQuery } from "../client.js";
import { mediaRefs } from "./convert.js";
import type {
  AnkiCardData,
  AnkiCollection,
  AnkiDeckData,
  AnkiNotetypeData,
  AnkiReviewData,
} from "./read.js";

const DAY_MS = 86_400_000;
const CHUNK = 500;

interface ModelJson {
  id: number;
  name: string;
  type: number;
  css: string;
  flds: { name: string; ord: number }[];
  tmpls: { name: string; ord: number; qfmt: string; afmt: string }[];
}

interface DeckConfigJson {
  new?: { delays?: number[]; perDay?: number };
  lapse?: { delays?: number[] };
  rev?: { maxIvl?: number };
  desiredRetention?: number;
}

function optionsOf(c: DeckConfigJson | null | undefined): DeckOptions {
  if (!c) return DEFAULT_DECK_OPTIONS;
  return {
    ...DEFAULT_DECK_OPTIONS,
    ...(Array.isArray(c.new?.delays) ? { learningSteps: c.new.delays.filter((x) => x > 0) } : {}),
    ...(Array.isArray(c.lapse?.delays)
      ? { relearningSteps: c.lapse.delays.filter((x) => x > 0) }
      : {}),
    ...(c.rev?.maxIvl ? { maxInterval: c.rev.maxIvl } : {}),
    ...(typeof c.new?.perDay === "number" ? { newPerDay: c.new.perDay } : {}),
    ...(c.desiredRetention ? { desiredRetention: c.desiredRetention } : {}),
  };
}

/** Read the given decks (exact names) from Anki. */
export async function collectionFromAnki(
  anki: AnkiConnectClient,
  deckNames: readonly string[],
  onProgress?: (message: string) => void,
): Promise<AnkiCollection> {
  const decks: AnkiDeckData[] = [];
  const noteIds = new Set<number>();
  for (const [i, name] of deckNames.entries()) {
    const config = await anki
      .invoke<DeckConfigJson | false>("getDeckConfig", { deck: name })
      .catch(() => null);
    decks.push({ id: i + 1, name, options: optionsOf(config || null) });
    for (const id of await anki.findNotes(exactDeckQuery(name))) noteIds.add(id);
  }
  onProgress?.(`Reading ${noteIds.size} notes from Anki`);
  const infos = await anki.notesInfo([...noteIds]);
  const modelNames = [...new Set(infos.map((n) => n.modelName))];
  const models = await anki
    .invoke<ModelJson[]>("findModelsByName", { modelNames })
    .catch(() => [] as ModelJson[]);
  const notetypes: AnkiNotetypeData[] = modelNames.map((name, i) => {
    const m = models.find((x) => x?.name === name);
    if (m) {
      return {
        id: m.id,
        name,
        kind: m.type === 1 ? "cloze" : "standard",
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: [...m.tmpls]
          .sort((a, b) => a.ord - b.ord)
          .map((t) => ({ name: t.name, front: t.qfmt, back: t.afmt })),
        css: m.css,
      };
    }
    // Without the full model, field order comes from the first note and no templates.
    const first = infos.find((n) => n.modelName === name);
    const fields = Object.entries(first?.fields ?? {})
      .sort((a, b) => a[1].order - b[1].order)
      .map(([f]) => f);
    return { id: -(i + 1), name, kind: "standard", fields, templates: [], css: "" };
  });
  const typeId = new Map(notetypes.map((t) => [t.name, t.id]));
  const notes = infos.map((n) => ({
    id: n.noteId,
    notetypeId: typeId.get(n.modelName) ?? 0,
    fields: Object.values(n.fields)
      .sort((a, b) => a.order - b.order)
      .map((f) => f.value),
    tags: n.tags,
  }));

  onProgress?.("Reading cards and review history");
  const deckId = new Map(decks.map((d) => [d.name, d.id]));
  const cardInfos = await anki.cardsInfo(infos.flatMap((n) => n.cards));
  const reviews: AnkiReviewData[] = [];
  const lastReview = new Map<number, number>();
  const ids = cardInfos.map((c) => c.cardId);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await anki.invoke<
      Record<string, { id: number; ease: number; type: number; time: number }[]>
    >("getReviewsOfCards", { cards: ids.slice(i, i + CHUNK).map(String) });
    for (const [cid, list] of Object.entries(res)) {
      for (const r of list) {
        reviews.push({ cardId: Number(cid), at: r.id, ease: r.ease, type: r.type, timeMs: r.time });
        lastReview.set(Number(cid), Math.max(lastReview.get(Number(cid)) ?? 0, r.id));
      }
    }
  }
  reviews.sort((a, b) => a.at - b.at);
  const cards: AnkiCardData[] = cardInfos.flatMap((c) => {
    // A card in a subdeck that was not chosen stays behind.
    const did = deckId.get(c.deckName);
    if (did === undefined) return [];
    const card: AnkiCardData = {
      id: c.cardId,
      noteId: c.note,
      deckId: did,
      ord: (c as { ord?: number }).ord ?? 0,
      type: c.type,
      queue: c.queue,
      intervalDays: Math.max(0, c.interval),
    };
    if (c.type === 0) card.newPosition = (c as { due?: number }).due ?? 0;
    else {
      const last = lastReview.get(c.cardId);
      if (last !== undefined && c.interval > 0) card.dueMs = last + c.interval * DAY_MS;
    }
    return [card];
  });

  const names = new Set(notes.flatMap((n) => n.fields.flatMap(mediaRefs)));
  for (const t of notetypes) {
    for (const tp of t.templates)
      for (const r of [...mediaRefs(tp.front), ...mediaRefs(tp.back)]) names.add(r);
  }
  const media = [...names].map((name) => ({
    name,
    bytes: async () => {
      const b64 = await anki.invoke<string | false>("retrieveMediaFile", { filename: name });
      if (!b64) return new Uint8Array(0);
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
  }));
  return { notetypes, decks, notes, cards, reviews, media };
}
