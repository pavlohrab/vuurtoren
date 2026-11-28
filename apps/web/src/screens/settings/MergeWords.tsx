/**
 * Settings → Your words: Merge your words (mock merge-and-direction.html). Words held twice
 * merge by themselves; near matches come one pair at a time, with what the merged card keeps.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Spinner } from "@app/ui";
import { plural } from "../../format.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { fillFrom, type NearPair } from "../../services/mergeWords.js";

const AFFECTED = ["learner", "review", "words", "home", "practice"];

/** After this many pairs, one button merges the rest. */
const ALL_AFTER = 3;

export function MergeWords() {
  const services = useServices();
  const qc = useQueryClient();
  const [pairs, setPairs] = useState<NearPair[]>([]);
  const [decided, setDecided] = useState(0);
  const find = useMutation({
    mutationFn: () => services.mergeWords(),
    onSuccess: async (r) => {
      setPairs(r.pairs);
      setDecided(0);
      if (r.merged) for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const merge = useMutation({
    mutationFn: async (some: NearPair[]) => {
      for (const p of some) await services.mergePair(p);
    },
    onSuccess: async (_, some) => {
      setPairs((ps) => ps.filter((p) => !some.includes(p)));
      setDecided((n) => n + some.length);
      for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const pair = pairs[0];
  const keepBoth = () => {
    if (!pair) return;
    services.keepPairApart(pair);
    setPairs((ps) => ps.slice(1));
    setDecided((n) => n + 1);
  };

  return (
    <section className="stack" aria-labelledby="merge-h">
      <h3 className="settings-h3" id="merge-h">
        Merge your words
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        One card for each word. The card with your reviews stays.
      </p>
      {find.data === undefined ? (
        <div>
          <Button onClick={() => find.mutate()} disabled={find.isPending}>
            {find.isPending ? <Spinner label="Looking" /> : null}
            Find words you have twice
          </Button>
        </div>
      ) : (
        <p role="status" className="merge-done">
          {find.data.merged
            ? `${plural(find.data.merged, "word")} you had twice ${find.data.merged === 1 ? "is" : "are"} one card now.`
            : "No word was there twice."}
          {pairs.length
            ? ` Check ${pairs.length === 1 ? "this one" : `these ${pairs.length}`}:`
            : ""}
        </p>
      )}
      {find.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(find.error)}
        </p>
      ) : null}
      {pair ? (
        <PairCard
          pair={pair}
          busy={merge.isPending}
          onMerge={() => merge.mutate([pair])}
          onKeepBoth={keepBoth}
          onMergeAll={decided >= ALL_AFTER ? () => merge.mutate(pairs) : undefined}
          left={pairs.length}
        />
      ) : null}
      {merge.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {errorText(merge.error)}
        </p>
      ) : null}
    </section>
  );
}

const ORIGIN: Record<string, string> = {
  vuurtoren: "Vuurtoren",
  apkg: "a deck file",
  anki: "Anki",
};

function Side({ n }: { n: NearPair["keep"] }) {
  const note = n.note;
  return (
    <div className="merge-side">
      <span className="merge-from">
        From {ORIGIN[n.origin] ?? n.origin} ·{" "}
        {n.reviews ? plural(n.reviews, "review") : "no reviews"}
      </span>
      <span className="merge-word" lang="nl">
        {note.article ? `${note.article} ` : ""}
        {note.key}
      </span>
      {note.gloss ? <span className="merge-gloss">{note.gloss}</span> : null}
    </div>
  );
}

function PairCard({
  pair,
  busy,
  onMerge,
  onKeepBoth,
  onMergeAll,
  left,
}: {
  pair: NearPair;
  busy: boolean;
  onMerge: () => void;
  onKeepBoth: () => void;
  onMergeAll: (() => void) | undefined;
  left: number;
}) {
  const fill = fillFrom(pair.keep, [pair.drop]);
  const keep = pair.keep.note;
  const adds = [
    fill.article ? "article" : null,
    fill.gloss ? "meaning" : null,
    fill.sentence ? "sentence" : null,
    fill.audio || fill.sentenceAudio ? "recording" : null,
  ].filter((x): x is string => !!x);
  return (
    <div className="merge-pair">
      <span className="merge-why">
        {pair.why === "form" ? "Same word, another form" : "Spelled almost the same"} · {left} left
      </span>
      <div className="merge-sides">
        <Side n={pair.keep} />
        <Side n={pair.drop} />
      </div>
      <div className="merge-result">
        <span className="merge-from">After merging</span>
        <span className="merge-word" lang="nl">
          {(fill.article ?? keep.article) ? `${fill.article ?? keep.article} ` : ""}
          {keep.key}
        </span>
        <span className="merge-gloss">
          {[
            fill.gloss ?? keep.gloss,
            pair.keep.reviews ? `${plural(pair.keep.reviews, "review")} kept` : null,
            ...adds.map((a) => `+ ${a}`),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" onClick={onMerge} disabled={busy}>
          Merge
        </Button>
        <Button onClick={onKeepBoth} disabled={busy}>
          Keep both
        </Button>
        {onMergeAll && left > 1 ? (
          <Button variant="ghost" onClick={onMergeAll} disabled={busy}>
            Merge all {left}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
