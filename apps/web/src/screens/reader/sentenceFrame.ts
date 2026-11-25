/**
 * The Dutch sentence frame of a sentence (m5, WC4; notes/wc2-word-card.md §5): first place ·
 * the conjugated verb · the middle · the verb end, worked out on the device from what every
 * analysed token already has (part of speech, morphology, dependency label and head). No new
 * data, so it works for stories, synced texts and live analysis alike.
 *
 * Every clause gets its parts (F3, notes/wc6-sentence-structures.md): main clauses, questions,
 * commands, subordinate and relative clauses, one row each in the tab. A sentence with no
 * conjugated verb (a fragment) has none: the tab then shows only the kinds of words. Tested on a
 * set with answers written by hand (frames.cases.ts).
 */
import type { AnalyzedToken } from "@app/core";

export type ClauseKind = "main" | "question" | "command" | "sub" | "rel" | "phrase";

/** A part of a clause: its words, and where a clause inside it sits ([…]). */
type ClauseItem = number | { clause: number };

export interface ClausePart {
  /**
   * main-like: link (en, maar, want, dus before the clause), first, verb, middle, end, rest;
   * sub-like: intro, middle, verbs, rest.
   */
  field: "link" | "first" | "verb" | "middle" | "end" | "rest" | "intro" | "verbs" | "words";
  items: ClauseItem[];
}

export interface Clause {
  kind: ClauseKind;
  parts: ClausePart[];
  /** The clause this one sits in, or null for a main clause. */
  parent: number | null;
  /** Its conjugated verb; -1 for a phrase without one. */
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
/** Words that open an infinitive clause with "te": om te zien, zonder te kijken, door te lezen. */
const OM_WORDS = new Set(["om", "zonder", "door"]);
/** Verbs that take a bare infinitive: kan zwemmen, gaat slapen, hoort haar zingen. */
const BARE_INF = new Set([
  "kunnen",
  "moeten",
  "willen",
  "zullen",
  "mogen",
  "hoeven",
  "gaan",
  "komen",
  "blijven",
  "laten",
  "zien",
  "horen",
  "voelen",
  "helpen",
  "leren",
  "doen",
  "durven",
  "liggen",
  "staan",
  "zitten",
  "lopen",
]);
const isVerb = (t: AnalyzedToken) => t.pos === "VERB" || t.pos === "AUX";
const isWord = (t: AnalyzedToken) => t.pos !== "PUNCT" && t.pos !== "SPACE";
/** Words that open a subordinate or relative clause: omdat, die, wie, waarop … */
function introduces(t: AnalyzedToken): boolean {
  if (t.pos === "SCONJ") return true;
  if (t.dep === "mark" && t.pos !== "CCONJ" && t.text.toLowerCase() !== "te") return true;
  if (/PronType=(Rel|Int)/.test(t.morph)) return true;
  // waarop, waarin; not waarheid
  return /^waar/i.test(t.text) && (t.pos === "ADV" || t.pos === "PRON");
}

/**
 * The tokens with their sentence-structure parse (SyntaxDot, `syn`) in place of spaCy's, where the
 * server had one. The words, sentences and offsets stay the same.
 */
export function frameTokens(tokens: readonly AnalyzedToken[]): AnalyzedToken[] {
  // A split verb's particle the usual analysis found ("blijf … thuis") stays when SyntaxDot's
  // parse has none for the word.
  return tokens.map((t) =>
    t.syn ? { ...t, ...t.syn, particle_of: t.syn.particle_of ?? t.particle_of } : t,
  );
}

/** The clauses of sentence `sent`, main clauses first in reading order; [] for a fragment. */
export function sentenceClauses(tokens: readonly AnalyzedToken[], sent: number): Clause[] {
  const words = tokens.filter((t) => t.sent === sent && isWord(t));
  const low = (t: AnalyzedToken | undefined) => t?.text.toLowerCase();
  const isInf = (t: AnalyzedToken | undefined) =>
    !!t && isVerb(t) && t.morph.includes("VerbForm=Inf");
  /** "aan het" before an infinitive (is … aan het lezen): it goes with the verb. */
  const aanHet = (t: AnalyzedToken): boolean =>
    (low(t) === "aan" && low(tokens[t.i + 1]) === "het" && isInf(tokens[t.i + 2])) ||
    (low(t) === "het" && low(tokens[t.i - 1]) === "aan" && isInf(tokens[t.i + 1]));
  // An infinitive used as a noun: "houdt van zwemmen", "zich zorgen maakt" (houden and maken take
  // no bare infinitive).
  const nounLike = (t: AnalyzedToken): boolean => {
    // also a conjugated form the parser hangs on a verb ("sprong in Toms armen")
    if (!t.morph.includes("VerbForm=Inf") && t.dep !== "xcomp") return false;
    if (words.some((x) => x.head === t.i && x.text.toLowerCase() === "te")) return false;
    // "van zwemmen": an infinitive in a noun's place with a preposition of its own
    // ("gaan uit eten" stays a verb: gaan takes a bare infinitive)
    const up = tokens[t.head];
    if (
      /^(obl|obj|nsubj)/.test(t.dep) &&
      words.some((x) => x.head === t.i && x.dep === "case") &&
      !(up && BARE_INF.has(up.lemma.toLowerCase()))
    )
      return true;
    // "zo leuk als vissen"
    const kids = words.filter((x) => x.head === t.i);
    if (kids.some((x) => x.pos === "SCONJ") && !kids.some((x) => x.dep.startsWith("aux")))
      return true;
    const h = tokens[t.head];
    return t.dep === "xcomp" && !!h && h.pos === "VERB" && !BARE_INF.has(h.lemma.toLowerCase());
  };
  // Conjugated verbs, with two repairs of the parser's forms. An infinitive after a modal is
  // sometimes tagged conjugated ("wil … wonen"): xcomp means it isn't. A plural present looks like
  // an infinitive ("die ze nooit hebben besproken"): a helper in a clause of its own with no
  // conjugated verb is the conjugated one.
  // A noun the parser calls a verb isn't one either: right after an article ("de was") or
  // alone in a noun's place ("Er komt mist").
  const afterArticle = (t: AnalyzedToken) => {
    const b = tokens[t.i - 1];
    return !!b && b.sent === sent && b.pos === "DET" && /Definite=/.test(b.morph);
  };
  const finite = words.filter(
    (t) =>
      isVerb(t) &&
      t.morph.includes("VerbForm=Fin") &&
      t.dep !== "xcomp" &&
      !(/^(nsubj|obj|iobj|obl)/.test(t.dep) && !words.some((x) => x.head === t.i && x.i !== t.i)) &&
      !afterArticle(t),
  );
  for (const t of words) {
    if (t.pos !== "AUX" || t.dep !== "aux" || !t.morph.includes("VerbForm=Inf")) continue;
    const head = tokens[t.head];
    if (!head || !["acl:relcl", "advcl", "ccomp", "csubj"].includes(head.dep)) continue;
    const helpers = words.filter((x) => x.head === head.i && (x.dep === "aux" || x.dep === "cop"));
    if (!helpers.some((x) => finite.includes(x)) && !finite.includes(head)) finite.push(t);
  }
  finite.sort((a, b) => a.i - b.i);
  // Two helpers tagged conjugated on one verb ("had … moeten zeggen", "zal … zijn"): only the
  // first is; the second belongs in the verb end.
  const demoted = new Set<number>();
  for (const t of [...finite]) {
    if (t.dep !== "aux" && t.dep !== "cop") continue;
    if (
      finite.some(
        (x) =>
          x.i < t.i &&
          x.head === t.head &&
          (x.dep === "aux" || x.dep === "cop") &&
          // not across an introducer: "is het eilandje waarop de toren stond … geworden"
          !words.some((w) => w.i > x.i && w.i < t.i && introduces(w)),
      )
    ) {
      demoted.add(t.i);
      finite.splice(finite.indexOf(t), 1);
    }
  }
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
  // "om … te" clauses: an infinitive with om (zonder, door) and te of its own is a clause too.
  for (const t of words) {
    if (preds.has(t.i) || !isVerb(t) || !t.morph.includes("VerbForm=Inf")) continue;
    const kids = words.filter((c) => c.head === t.i);
    const te = kids.some((c) => c.text.toLowerCase() === "te");
    if (te && kids.some((c) => OM_WORDS.has(c.text.toLowerCase()))) preds.set(t.i, t);
    // A te-infinitive with its own object is a clause too ("uw kantoor te bellen"); a bare one
    // stays in the verb end ("te slapen", "gemakkelijk te vinden").
    // Not after the conjugated verb itself: "begon … te onderzoeken" is one verb group.
    else if (
      te &&
      kids.some((c) => ["obj", "iobj", "ccomp"].includes(c.dep)) &&
      !tokens[t.head]?.morph.includes("VerbForm=Fin")
    )
      preds.set(t.i, t);
  }
  // The word a conjunction hangs on opens a clause, whatever the parser calls it ("als ze oud
  // worden", "omdat hij niet oplet", "als hij het vuur aanmaakt").
  for (const m of words) {
    if (m.pos !== "SCONJ" || m.dep !== "mark") continue;
    const h = tokens[m.head];
    if (!h || h.sent !== sent || preds.has(h.i) || h.i === m.i) continue;
    // "dat ze zich gehaat voelde": the parse hangs dat on the participle; voelde is the verb
    const up = tokens[h.head];
    if (up && up.i > h.i && finite.includes(up)) continue;
    const helped = words.some((x) => x.head === h.i && finite.includes(x));
    // "zo diep als de zee", "zo leuk als vissen": no subject and no conjugated verb, no clause
    const clauseLike =
      (isVerb(h) && !h.morph.includes("VerbForm=Inf")) ||
      words.some((x) => x.head === h.i && x.dep.startsWith("nsubj"));
    if (!helped && clauseLike) preds.set(h.i, h);
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
    /** Quoted speech before its reporting verb: a row under "zegt hij", its kind its own. */
    quote?: boolean;
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
    const fins = d.own.filter(
      (t) => isVerb(t) && t.morph.includes("VerbForm=Fin") && !demoted.has(t.i),
    );
    for (const v of fins.slice(1)) {
      const from = d.own.findIndex((t) => t.i > fins[0]!.i && t.i < v.i && introduces(t));
      if (from < 0) continue;
      const span = d.own.filter((t) => t.i >= d.own[from]!.i && t.i <= v.i);
      d.own = d.own.filter((t) => !span.includes(t));
      const intro = d.own[from] ?? span[0]!;
      const rel = /PronType=Rel/.test(span[0]!.morph) || /^waar/i.test(span[0]!.text);
      drafts.push({
        // Its own key, also when the split-off verb was this clause's (a parse that hangs
        // "was" on "beschuldigde"): two clauses can't share one.
        pred: v.i === d.pred ? -(v.i + 1) : v.i,
        verb: v,
        own: span,
        kind: rel ? "rel" : "sub",
        parentPred: d.pred,
        anchor: intro.i > 0 ? (tokens[span[0]!.i - 1]?.i ?? null) : null,
      });
    }
  }
  // A clause joined with en to a subordinate or relative one is one too, in the same place
  // ("zodat hij kon trouwen en een eigen leven kon beginnen").
  for (const d of drafts) {
    const dp = tokens[d.pred];
    if (!dp || dp.dep !== "conj") continue;
    const head = drafts.find((x) => x.pred === dp.head);
    if (head && (head.kind === "sub" || head.kind === "rel")) {
      d.kind = head.kind;
      d.parentPred = head.parentPred;
    }
  }
  // "…, en van het slik is niets meer te zien": after en, maar … a clause with its verb second and
  // words after it is a second main clause, whatever the parse hangs it on.
  for (const d of drafts) {
    if (d.kind !== "sub" || d.own[0]?.dep !== "cc") continue;
    const beforeVerb = d.own.filter((t) => t.i < d.verb.i);
    const afterVerb = d.own.filter(
      (t) => t.i > d.verb.i && !isVerb(t) && t.text.toLowerCase() !== "te",
    );
    if (beforeVerb.length > 1 && afterVerb.length && !beforeVerb.some(introduces)) {
      d.kind = "main";
      d.parentPred = null;
    }
  }
  // Quoted speech ("Ik weet het," zegt hij): the quote sits in the reporting clause's first
  // place, as a row of its own under it. Two shapes in the parse: the quote is the root and the
  // reporting verb hangs on it (parataxis), or the quote hangs on the reporting verb.
  const lastOf = (d: Draft) => d.own.at(-1)?.i ?? -1;
  for (const r of drafts) {
    const rp = tokens[r.pred];
    if (!rp || rp.dep !== "parataxis" || r.own.some((t) => t.i < r.verb.i)) continue;
    const h = drafts.find((d) => d.pred === rp.head && d !== r);
    if (h && lastOf(h) < r.verb.i && h.parentPred === null) {
      h.parentPred = r.pred;
      h.quote = true;
    }
  }
  // "Dan moet je ze bellen!" roept Noor: the quote hangs on the reporting verb right after it.
  for (const q of drafts) {
    const qp = tokens[q.pred];
    if (q.quote || !qp || qp.dep !== "parataxis" || q.parentPred !== null) continue;
    const p = drafts.find((d) => d.pred === qp.head && d !== q);
    if (!p || lastOf(q) >= p.verb.i || p.own.some((t) => t.i < p.verb.i)) continue;
    if (tokens.slice(lastOf(q) + 1, p.verb.i).every((t) => !isWord(t))) {
      q.parentPred = p.pred;
      q.quote = true;
    }
  }
  for (const q of drafts) {
    if (q.quote || q.parentPred === null || q.kind === "phrase") continue;
    const p = drafts.find((d) => d.pred === q.parentPred);
    if (!p || lastOf(q) >= p.verb.i || introduces(q.own[0]!)) continue;
    const between = tokens.slice(lastOf(q) + 1, p.verb.i);
    if (between.every((t) => !isWord(t)) && !p.own.some((t) => t.i < p.verb.i)) {
      q.quote = true;
      q.kind = "main";
    }
  }
  // After a colon ("Hij zegt: "Ik heb geen tijd.""), the quote sits in the clause before it.
  for (const q of drafts) {
    const first = q.own[0];
    if (!first) continue;
    let b = first.i - 1;
    while (b >= 0 && tokens[b]!.sent === sent && !isWord(tokens[b]!) && tokens[b]!.text !== ":")
      b--;
    if (b < 0 || tokens[b]!.text !== ":") continue;
    const before = words.filter((t) => t.i < b).at(-1);
    const p = before && drafts.find((d) => d !== q && d.own.includes(before));
    if (!p) continue;
    if (p.parentPred === q.pred) {
      p.parentPred = null;
      p.quote = false;
    }
    q.parentPred = p.pred;
    q.quote = true;
  }
  for (const d of drafts) if (d.quote) d.kind = "main";
  // "Waar u ook maar wilt.", "Omdat ik moe ben.": a sentence that is one clause inside, alone.
  const asked = tokens.some((t) => t.sent === sent && t.text === "?");
  for (const d of drafts) {
    if (d.kind !== "main" || d.parentPred !== null || d.quote || asked) continue;
    if (tokens[d.pred]?.dep !== "ROOT" || !d.own[0] || !introduces(d.own[0])) continue;
    if (d.own.length > 2 && d.own.every((t) => t.i <= d.verb.i || isVerb(t))) d.kind = "sub";
  }
  // Words no clause took: a phrase without a verb ("Een boek waarin alles staat", "Dank je wel
  // dat …"). It gets a row of its own, and the clauses hanging on it sit inside it.
  const taken = new Set(drafts.flatMap((d) => d.own.map((t) => t.i)));
  const loose = words.filter((t) => !taken.has(t.i));
  if (loose.length) {
    const phrase = loose[0]!;
    for (const d of drafts) if (d.parentPred === null && d.kind !== "main") d.parentPred = phrase.i;
    drafts.push({
      pred: phrase.i,
      verb: phrase,
      own: loose,
      kind: "phrase",
      parentPred: null,
      anchor: null,
    });
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
    if (kind === "phrase") {
      const items: ClauseItem[] = own.map(at);
      for (const { c, j } of children) {
        const pos = items.findIndex((x) => typeof x === "number" && x > c.own[0]!.i);
        items.splice(pos < 0 ? items.length : pos, 0, { clause: j });
      }
      return { kind, parts: [{ field: "words" as const, items }], parent: null, verb: -1 };
    }
    if (kind === "main" || kind === "question" || kind === "command") {
      // A quote before "vraagt Mila" keeps its first word ("En de rest?").
      const reporting = tokens[d.pred]?.dep === "parataxis";
      const lead =
        !reporting &&
        own[0] &&
        (own[0].dep === "cc" ||
          LINKS.has(own[0].text.toLowerCase()) ||
          // "Nee, deze gaat …", "Gelukkig, het probleem is …": one word and a comma before a
          // clause that has its own first place
          (tokens[own[0].i + 1]?.text === "," &&
            !own.some((t) => t.head === own[0]!.i && t.i !== own[0]!.i) &&
            own.filter((t) => t.i > own[0]!.i + 1 && t.i < d.verb.i).length > 0)) &&
        own[0].i < d.verb.i &&
        // "Dus ging ze slapen": dus right before the verb is the first place
        !(own[0].text.toLowerCase() === "dus" && own[1]?.i === d.verb.i)
          ? 1
          : 0;
      const body = own.slice(lead);
      const before = body.filter((t) => t.i < d.verb.i);
      const after = body.filter((t) => t.i > d.verb.i);
      // A verb in the verb end: not the conjugated one, not a participle before a noun
      // ("brandende huis"), not a noun the parser took for a verb ("geen eten"). The word the
      // helper hangs on belongs here even when it's tagged conjugated ("hebben … betrapt").
      const hasArticle = (t: AnalyzedToken) => words.some((x) => x.head === t.i && x.dep === "det");
      const endVerb = (t: AnalyzedToken) =>
        isVerb(t) &&
        t.i !== d.verb.i &&
        t.dep !== "amod" &&
        // with a copula the predicate stays in the middle ("is bewapend en gevaarlijk")
        !(t.i === d.pred && d.verb.dep === "cop") &&
        !hasArticle(t) &&
        !nounLike(t) &&
        (!t.morph.includes("VerbForm=Fin") ||
          t.i === d.pred ||
          t.dep === "xcomp" ||
          demoted.has(t.i));
      const endWord = (t: AnalyzedToken, next?: AnalyzedToken): boolean =>
        endVerb(t) ||
        t.particle_of !== null ||
        t.dep === "compound:prt" ||
        aanHet(t) ||
        // "te slapen", "uit eten": a small word before the verb (te always goes with it)
        (!!next &&
          isVerb(next) &&
          (t.text.toLowerCase() === "te" || (t.head === next.i && t.pos === "ADP")));
      let endFrom = after.length;
      while (endFrom > 0 && endWord(after[endFrom - 1]!, after[endFrom])) endFrom--;
      // Words after the verb end (rest): the end block is the last run of verb words, and
      // whatever follows it.
      let blockEnd = after.length;
      if (endFrom === after.length) {
        // No verb at the very end: find the last run of verb words, the rest follows it.
        let j = after.length - 1;
        while (j >= 0 && !endWord(after[j]!, after[j + 1])) j--;
        if (j >= 0 && endVerb(after[j]!)) {
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
      const top = d.parentPred === null && d.kind === "main" && tokens[d.pred]?.dep !== "conj";
      if (top || d.quote) {
        // A clause in first place ("Toen ik thuiskwam, was het …") counts as a first place.
        const startsWithVerb =
          before.length === 0 && !children.some(({ c }) => c.own[0]!.i < d.verb.i);
        // "Waar woon je?", and after a preposition: "Aan wie gaf je …?"
        const qAt = before[0]?.pos === "ADP" ? before[1] : before[0];
        const qWord = !!qAt && QUESTION_WORDS.has(qAt.text.toLowerCase());
        const hasSubject = own.some(
          (t) => t.dep.startsWith("nsubj") && (t.head === d.pred || t.head === d.verb.i),
        );
        // A quote ends at its own "?" ("Ben jij Hans?" vraagt hij), the sentence at its last one.
        const asks = d.quote
          ? tokens.slice(lastOf(d) + 1, lastOf(d) + 3).some((t) => t.text === "?")
          : endsWithQuestion;
        if (asks && (startsWithVerb || qWord)) kind = "question";
        else if (startsWithVerb && !hasSubject && !asks) kind = "command";
      }
      if (lead) push("link", [own[0]!.i]);
      push("first", withChildren("first", before));
      push("verb", [d.verb.i]);
      push("middle", withChildren("middle", middle));
      push("end", withChildren("end", end));
      push("rest", withChildren("rest", rest));
    } else {
      // sub, rel: introducer (with a preposition before it) · middle · verbs · rest
      // The introducer (omdat, die, om …); "en" for a clause joined to another one; none for a
      // te-clause ("uw kantoor te bellen").
      const teClause = own.some((t) => t.head === d.verb.i && t.text.toLowerCase() === "te");
      // "en dat alles … wordt bepaald": the joining word and the introducer together
      const introEnd =
        own[0]?.dep === "cc"
          ? own[1] && introduces(own[1])
            ? 1
            : 0
          : own.findIndex((t, n) =>
              teClause
                ? OM_WORDS.has(t.text.toLowerCase()) && t.dep === "mark"
                : // "hoe duur het is": a question word opens it too
                  introduces(t) || (n === 0 && QUESTION_WORDS.has(t.text.toLowerCase())),
            );
      const intro = own.slice(0, introEnd + 1);
      const body = own.slice(introEnd + 1);
      let vEnd = body.length;
      // the clause's own verb counts, also when the parser calls it something else ("oplet")
      const inVerbs = (x: AnalyzedToken) => (isVerb(x) && !nounLike(x)) || x.i === d.verb.i;
      while (vEnd > 0 && !inVerbs(body[vEnd - 1]!)) vEnd--;
      let vStart = vEnd;
      while (
        vStart > 0 &&
        (inVerbs(body[vStart - 1]!) ||
          aanHet(body[vStart - 1]!) ||
          // te, and a split verb's particle before it ("toe te geven")
          ((body[vStart - 1]!.text.toLowerCase() === "te" ||
            body[vStart - 1]!.particle_of !== null) &&
            vStart < vEnd))
      )
        vStart--;
      // A clause inside this one ("om te zien [of ze zou bewegen]"): after the verbs in rest,
      // else in the middle.
      const lastVerb = body[vEnd - 1]?.i ?? d.verb.i;
      const place = (list: AnalyzedToken[], here: (start: number) => boolean): ClauseItem[] => {
        const items: ClauseItem[] = list.map(at);
        for (const { c, j } of children) {
          if (!here(c.own[0]!.i)) continue;
          const pos = items.findIndex((x) => typeof x === "number" && x > c.own[0]!.i);
          items.splice(pos < 0 ? items.length : pos, 0, { clause: j });
        }
        return items;
      };
      push("intro", intro.map(at));
      push(
        "middle",
        place(body.slice(0, vStart), (st) => st < lastVerb),
      );
      push("verbs", body.slice(vStart, vEnd).map(at));
      push(
        "rest",
        place(body.slice(vEnd), (st) => st > lastVerb),
      );
    }
    const parent = d.parentPred === null ? null : (indexOf.get(d.parentPred) ?? null);
    return { kind, parts, parent, verb: d.verb.i };
  });
}

/**
 * Signs the parse of sentence `sent` is likely wrong (notes/f3-parser-exp.md): a phrase without
 * a verb beside a main clause, or a main word that is a participle or a noun while a conjugated verb
 * sits elsewhere (not a quote's reporting verb: "Goed," zegt de man). A sentence without a verb is
 * left alone: stories use short phrases on purpose.
 */
export function structureDoubtful(
  tokens: readonly AnalyzedToken[],
  sent: number,
  clauses: readonly Clause[],
): boolean {
  const words = tokens.filter((t) => t.sent === sent && isWord(t));
  if (words.length < 4) return false;
  const fin = words.filter((t) => isVerb(t) && t.morph.includes("VerbForm=Fin"));
  if (!clauses.length) return false;
  // A phrase beside a main clause: words the main clause should have held ("… meneer Haddad").
  // A phrase with a clause inside it is fine ("Een boek waarin alles staat").
  const main = clauses.some(
    (c) => c.kind === "main" || c.kind === "question" || c.kind === "command",
  );
  if (clauses.some((c) => c.kind === "phrase") && main) return true;
  for (const r of words.filter((t) => t.dep === "ROOT")) {
    const kids = words.filter((k) => k.head === r.i && k.i !== r.i);
    const helped = kids.some((k) => k.dep.startsWith("aux") || k.dep === "cop");
    if (r.pos === "VERB" && /VerbForm=(Part|Inf)/.test(r.morph) && !helped) return true;
    const reporting = fin.some((f) => f.head === r.i);
    if (/^(NOUN|PROPN|ADJ|ADV|PRON|NUM)$/.test(r.pos) && !helped && fin.length && !reporting)
      return true;
  }
  return false;
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
