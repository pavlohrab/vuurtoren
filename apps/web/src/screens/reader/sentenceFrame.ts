/**
 * The Dutch sentence frame of a sentence (m5, WC4; notes/wc2-word-card.md §5): first place ·
 * the conjugated verb · the middle · the verb end, worked out on the device from what every
 * analysed token already has (part of speech, morphology, dependency label and head). No new
 * data, so it works for stories, synced texts and live analysis alike.
 *
 * v1 covers the main clause; a subordinate clause after the verb end is one part, "rest". A
 * sentence without a conjugated verb in its main clause (a fragment like "Nou ja,") has no
 * frame: the tab then shows only the kinds of words.
 */
import type { AnalyzedToken } from "@app/core";

export type Field = "first" | "verb" | "middle" | "end" | "rest";

interface FramePart {
  field: Field;
  /** Token indices (into the text's tokens), in order. */
  tokens: number[];
}

export interface Frame {
  parts: FramePart[];
  /** The conjugated verb of the main clause. */
  verb: number;
  /** The particle of a split verb ("doet … open"), when there is one. */
  particle: number | null;
}

/** Dependency labels that start a clause of their own. */
const SUBCLAUSE = new Set(["advcl", "ccomp", "acl", "acl:relcl", "csubj", "xcomp", "parataxis"]);

const finite = (t: AnalyzedToken) =>
  (t.pos === "VERB" || t.pos === "AUX") && t.morph.includes("VerbForm=Fin");
const nonFinite = (t: AnalyzedToken) =>
  (t.pos === "VERB" || t.pos === "AUX") && /VerbForm=(Inf|Part)/.test(t.morph);

/** Is `t` inside a clause of its own (on its way up to the root it passes a clause label)? */
function inSubclause(tokens: readonly AnalyzedToken[], t: AnalyzedToken): boolean {
  let cur = t;
  for (let guard = 0; guard < 64; guard++) {
    if (SUBCLAUSE.has(cur.dep)) return true;
    const up = tokens[cur.head];
    if (!up || up.i === cur.i) return false;
    cur = up;
  }
  return false;
}

export function sentenceFrame(tokens: readonly AnalyzedToken[], sent: number): Frame | null {
  const words = tokens.filter((t) => t.sent === sent && t.pos !== "PUNCT" && t.pos !== "SPACE");
  const main = words.filter((t) => !inSubclause(tokens, t));
  const verb = main.find(finite);
  if (!verb) return null;
  const particle = main.find((t) => t.particle_of === verb.i)?.i ?? null;

  const before = main.filter((t) => t.i < verb.i);
  const after = words.filter((t) => t.i > verb.i);
  // The verb end: the particle and the other verbs of the main clause, at its end.
  const closes = (t: AnalyzedToken) =>
    !inSubclause(tokens, t) && (t.i === particle || nonFinite(t));
  const mainAfter = after.filter((t) => !inSubclause(tokens, t));
  let endStart = mainAfter.length;
  while (endStart > 0 && closes(mainAfter[endStart - 1]!)) endStart--;
  const end = mainAfter.slice(endStart);
  const endFrom = end[0]?.i ?? Infinity;
  const middle = after.filter((t) => t.i < endFrom && !inSubclause(tokens, t));
  const rest = after.filter((t) => inSubclause(tokens, t) && t.i > (end.at(-1)?.i ?? verb.i));
  // Words of a clause of their own inside the middle stay in the middle.
  const inside = after.filter((t) => inSubclause(tokens, t) && t.i < endFrom && !rest.includes(t));

  const parts: FramePart[] = [];
  const add = (field: Field, list: readonly AnalyzedToken[]) => {
    if (list.length) parts.push({ field, tokens: list.map((t) => t.i).sort((a, b) => a - b) });
  };
  add("first", before);
  add("verb", [verb]);
  add("middle", [...middle, ...inside]);
  add("end", end);
  add("rest", rest);
  return { parts, verb: verb.i, particle };
}

// ---------------------------------------------------------------------------------------------
// Every clause of a sentence (F3, notes/wc6-sentence-structures.md): one row per clause in the
// tab. Tested on a set with answers written by hand (frames.cases.ts).

export type ClauseKind = "main" | "question" | "command" | "sub" | "rel";

/** A part of a clause: its words, and where a clause inside it sits ([…]). */
export type ClauseItem = number | { clause: number };

export interface ClausePart {
  /** main-like: first, verb, middle, end, rest; sub-like: intro, middle, verbs, rest. */
  field: "first" | "verb" | "middle" | "end" | "rest" | "intro" | "verbs";
  items: ClauseItem[];
}

export interface Clause {
  kind: ClauseKind;
  parts: ClausePart[];
  /** The clause this one sits in, or null for a main clause. */
  parent: number | null;
  /** Its conjugated verb. */
  verb: number;
}

const QUESTION_WORDS = new Set([
  "wat",
  "wie",
  "waar",
  "wanneer",
  "hoe",
  "waarom",
  "welk",
  "welke",
  "hoeveel",
]);
const LINKS = new Set(["en", "maar", "want", "dus", "of"]);
const REL_WORDS = new Set(["die", "dat", "wie", "wat", "welke", "waar"]);
const isVerb = (t: AnalyzedToken) => t.pos === "VERB" || t.pos === "AUX";
const isWord = (t: AnalyzedToken) => t.pos !== "PUNCT" && t.pos !== "SPACE";
/** Words that open a subordinate or relative clause: omdat, die, wie, waarop … */
function introduces(t: AnalyzedToken): boolean {
  if (t.pos === "SCONJ") return true;
  if (/PronType=(Rel|Int)/.test(t.morph)) return true;
  return /^waar/i.test(t.text) && t.pos !== "VERB";
}

/** The clauses of sentence `sent`, main clauses first in reading order; [] for a fragment. */
export function sentenceClauses(tokens: readonly AnalyzedToken[], sent: number): Clause[] {
  const words = tokens.filter((t) => t.sent === sent && isWord(t));
  const finite = words.filter((t) => isVerb(t) && t.morph.includes("VerbForm=Fin"));
  if (!finite.length) return [];
  // The predicate of each conjugated verb: the verb, or the word a helping verb hangs on.
  const predicateOf = (v: AnalyzedToken) =>
    (v.dep === "aux" || v.dep === "cop" || v.dep.startsWith("aux:")) && tokens[v.head]
      ? tokens[v.head]!
      : v;
  const preds = new Map<number, AnalyzedToken>(); // predicate index → its conjugated verb
  for (const v of finite) {
    const p = predicateOf(v);
    if (!preds.has(p.i)) preds.set(p.i, v);
  }
  // Each word's clause: the nearest predicate above it.
  const owner = new Map<number, number>();
  for (const t of words) {
    let cur: AnalyzedToken | undefined = t;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (preds.has(cur.i)) break;
      const up: AnalyzedToken | undefined = tokens[cur.head];
      cur = up && up.i !== cur.i && up.sent === sent ? up : undefined;
    }
    if (cur) owner.set(t.i, cur.i);
  }
  // A non-verb root (a quote before "zegt hij"): its words go to the reporting clause.
  const root = words.find((t) => t.head === t.i || t.dep === "ROOT");
  if (root && !preds.has(root.i)) {
    const reporting = [...preds.keys()].find((p) => tokens[p]?.dep === "parataxis");
    if (reporting !== undefined)
      for (const t of words) if (!owner.has(t.i)) owner.set(t.i, reporting);
  }

  interface Draft {
    pred: number;
    verb: AnalyzedToken;
    own: AnalyzedToken[];
    kind: ClauseKind;
    parentPred: number | null;
    anchor: number | null;
  }
  const drafts: Draft[] = [];
  const kindOf = (pred: AnalyzedToken, own: readonly AnalyzedToken[]): ClauseKind => {
    if (pred.dep === "acl:relcl") return "rel";
    const top = pred.dep === "ROOT" || pred.head === pred.i;
    if (top || pred.dep === "conj" || pred.dep === "parataxis") return "main";
    // A clause in another's place (subject, object …): a relative one when it opens with a
    // relative word right after a noun ("de vrouw met wie je praat"), else a subordinate one.
    const lead = own[0]?.pos === "ADP" ? own[1] : own[0];
    const before = own[0] ? tokens[own[0].i - 1] : undefined;
    const afterNoun = !!before && /^(NOUN|PROPN)$/.test(before.pos);
    if (lead && REL_WORDS.has(lead.text.toLowerCase()) && afterNoun) return "rel";
    return "sub";
  };
  for (const [p, v] of preds) {
    const pred = tokens[p]!;
    const own = words.filter((t) => owner.get(t.i) === p);
    const kind = kindOf(pred, own);
    let parentPred: number | null = null;
    if (kind !== "main") {
      let up = tokens[pred.head];
      for (let guard = 0; up && guard < 64 && !preds.has(up.i); guard++) {
        const next = tokens[up.head];
        up = next && next.i !== up.i ? next : undefined;
      }
      parentPred = up && preds.has(up.i) ? up.i : null;
    }
    // A relative clause sits with its noun: the parse's, or the word right before it.
    const anchor =
      pred.dep === "acl:relcl" ? pred.head : own[0] ? (tokens[own[0].i - 1]?.i ?? null) : null;
    drafts.push({ pred: p, verb: v, own, kind, parentPred, anchor });
  }
  // Repair: two conjugated verbs in one clause with an introducer between them ("het eilandje
  // waarop de toren stond"): "introducer … verb" is a clause of its own.
  for (const d of [...drafts]) {
    const fins = d.own.filter((t) => isVerb(t) && t.morph.includes("VerbForm=Fin"));
    for (const v of fins.slice(1)) {
      const from = d.own.findIndex((t) => t.i > fins[0]!.i && t.i < v.i && introduces(t));
      if (from < 0) continue;
      const span = d.own.filter((t) => t.i >= d.own[from]!.i && t.i <= v.i);
      d.own = d.own.filter((t) => !span.includes(t));
      const intro = d.own[from] ?? span[0]!;
      const rel = /PronType=Rel/.test(span[0]!.morph) || /^waar/i.test(span[0]!.text);
      drafts.push({
        pred: v.i,
        verb: v,
        own: span,
        kind: rel ? "rel" : "sub",
        parentPred: d.pred,
        anchor: intro.i > 0 ? (tokens[span[0]!.i - 1]?.i ?? null) : null,
      });
    }
  }
  drafts.sort(
    (a, b) =>
      (a.parentPred === null ? 0 : 1) - (b.parentPred === null ? 0 : 1) ||
      a.own[0]!.i - b.own[0]!.i,
  );
  const indexOf = new Map(drafts.map((d, k) => [d.pred, k]));
  const last = words.at(-1);
  const endsWithQuestion = tokens.some(
    (t) => t.sent === sent && t.text === "?" && t.i > (last?.i ?? 0) - 2,
  );

  return drafts.map((d, k) => {
    const own = d.own;
    const children = drafts
      .map((c, j) => ({ c, j }))
      .filter(({ c }) => c.parentPred === d.pred && indexOf.get(c.pred) !== k);
    const at = (t: AnalyzedToken) => t.i;
    const parts: ClausePart[] = [];
    const push = (field: ClausePart["field"], items: ClauseItem[]) => parts.push({ field, items });
    let kind = d.kind;
    if (kind === "main" || kind === "question" || kind === "command") {
      // A quote before "vraagt Mila" keeps its first word ("En de rest?").
      const reporting = tokens[d.pred]?.dep === "parataxis";
      const lead =
        !reporting &&
        own[0] &&
        (own[0].dep === "cc" || LINKS.has(own[0].text.toLowerCase())) &&
        own[0].i < d.verb.i
          ? 1
          : 0;
      const body = own.slice(lead);
      const before = body.filter((t) => t.i < d.verb.i);
      const after = body.filter((t) => t.i > d.verb.i);
      const endWord = (t: AnalyzedToken, next?: AnalyzedToken): boolean =>
        (isVerb(t) && !t.morph.includes("VerbForm=Fin")) ||
        t.particle_of !== null ||
        t.dep === "compound:prt" ||
        // "te slapen", "uit eten": a small word that hangs on the infinitive right after it
        (!!next &&
          isVerb(next) &&
          t.head === next.i &&
          (t.text.toLowerCase() === "te" || t.pos === "ADP"));
      let endFrom = after.length;
      while (endFrom > 0 && endWord(after[endFrom - 1]!, after[endFrom])) endFrom--;
      // Words after the verb end (rest): the end block is the last run of verb words, and
      // whatever follows it.
      let blockEnd = after.length;
      if (endFrom === after.length) {
        // No verb at the very end: find the last run of verb words, the rest follows it.
        let j = after.length - 1;
        while (j >= 0 && !endWord(after[j]!, after[j + 1])) j--;
        if (j >= 0 && isVerb(after[j]!)) {
          blockEnd = j + 1;
          endFrom = j;
          while (endFrom > 0 && endWord(after[endFrom - 1]!, after[endFrom])) endFrom--;
        }
      }
      const middle = after.slice(0, endFrom);
      const end = after.slice(endFrom, blockEnd);
      const rest = after.slice(blockEnd);
      const lastOwn = body.at(-1)?.i ?? d.verb.i;
      const slotOf = (c: Draft): ClausePart["field"] => {
        const start = c.own[0]!.i;
        if (start < d.verb.i) return "first";
        if (end.length && start > end.at(-1)!.i) return "rest";
        if (end.length && start < end[0]!.i) return "middle";
        if (!end.length && start > lastOwn) {
          if (c.kind === "rel" && c.anchor !== null) {
            const a = tokens[c.anchor];
            if (a && a.i > d.verb.i) return "middle";
            if (a && a.i < d.verb.i) return "first";
          }
          return "rest";
        }
        return "middle";
      };
      const withChildren = (field: ClausePart["field"], list: AnalyzedToken[]): ClauseItem[] => {
        const items: ClauseItem[] = list.map(at);
        for (const { c, j } of children)
          if (slotOf(c) === field) {
            const pos = items.findIndex((x) => typeof x === "number" && x > c.own[0]!.i);
            items.splice(pos < 0 ? items.length : pos, 0, { clause: j });
          }
        return items;
      };
      if (d.parentPred === null && d.kind === "main" && tokens[d.pred]?.dep !== "conj") {
        // A clause in first place ("Toen ik thuiskwam, was het …") counts as a first place.
        const startsWithVerb =
          before.length === 0 && !children.some(({ c }) => c.own[0]!.i < d.verb.i);
        const qWord = before[0] && QUESTION_WORDS.has(before[0].text.toLowerCase());
        const hasSubject = own.some((t) => t.dep.startsWith("nsubj") && t.head === d.pred);
        if (endsWithQuestion && (startsWithVerb || qWord)) kind = "question";
        else if (startsWithVerb && !hasSubject && !endsWithQuestion) kind = "command";
      }
      push("first", withChildren("first", before));
      push("verb", [d.verb.i]);
      push("middle", withChildren("middle", middle));
      push("end", withChildren("end", end));
      push("rest", withChildren("rest", rest));
    } else {
      // sub, rel: introducer (with a preposition before it) · middle · verbs · rest
      let introEnd = own.findIndex(introduces);
      if (introEnd < 0) introEnd = 0;
      const intro = own.slice(0, introEnd + 1);
      const body = own.slice(introEnd + 1);
      let vEnd = body.length;
      while (vEnd > 0 && !isVerb(body[vEnd - 1]!)) vEnd--;
      let vStart = vEnd;
      while (
        vStart > 0 &&
        (isVerb(body[vStart - 1]!) ||
          (body[vStart - 1]!.text.toLowerCase() === "te" && vStart < vEnd))
      )
        vStart--;
      push("intro", intro.map(at));
      push("middle", body.slice(0, vStart).map(at));
      push("verbs", body.slice(vStart, vEnd).map(at));
      push("rest", body.slice(vEnd).map(at));
    }
    const parent = d.parentPred === null ? null : (indexOf.get(d.parentPred) ?? null);
    return { kind, parts, parent, verb: d.verb.i };
  });
}

/** The kind of word, in plain English (from spaCy's part of speech). */
export const WORD_KIND: Record<string, string> = {
  NOUN: "noun",
  PROPN: "name",
  VERB: "verb",
  AUX: "verb",
  ADJ: "adjective",
  ADV: "adverb",
  PRON: "pronoun",
  DET: "article",
  ADP: "preposition",
  CCONJ: "conjunction",
  SCONJ: "conjunction",
  NUM: "number",
  PART: "particle",
  INTJ: "interjection",
};

/** What a word does in its sentence, in plain words, when the parse says it clearly. */
export function wordRole(t: AnalyzedToken): string | null {
  switch (t.dep) {
    case "nsubj":
    case "nsubj:pass":
      return "who does it";
    case "obj":
      return "what";
    case "iobj":
      return "to whom";
    case "obl":
      return "where, when or how";
    case "advmod":
      return "how, when or where";
    case "compound:prt":
      return "part of the verb";
    case "aux":
    case "aux:pass":
      return "helping verb";
    case "cop":
      return "links to what follows";
    case "amod":
      return "says more about a noun";
    default:
      return null;
  }
}
