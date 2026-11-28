/**
 * Make my Anki words Vuurtoren words (mock anki-to-vuurtoren.html): what converts, one of the
 * learner's own words before and after, and Convert. Settings → Your words saves a backup
 * first; the welcome (right after the move from Anki, which keeps Anki as it was) does not.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Volume2 } from "lucide-react";
import { useState } from "react";
import { Button, Spinner } from "@app/ui";
import { saveFile } from "../../saveFile.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import type { AnkiConversion, ConvertExample } from "../../services/nativeTypes.js";
import { readLocalJSON, writeLocalJSON } from "../../storage/local.js";

const AFFECTED = ["learner", "review", "words", "home", "practice", "anki-conversion"];
const LATER = "vuurtoren.convert.later";
const fmt = (n: number) => n.toLocaleString("en");

export function useAnkiConversion(enabled = true) {
  const services = useServices();
  return useQuery({
    queryKey: ["anki-conversion"],
    queryFn: () => services.ankiConversion(),
    enabled,
    staleTime: 60_000,
  });
}

/** Convert, after a backup when `backup`; the progress as "300 of 1,240". */
export function useConvert(backup: boolean) {
  const services = useServices();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      if (backup) {
        setProgress("Saving a backup");
        const r = await services.exportPackage([]);
        saveFile(r.bytes, r.fileName, "application/octet-stream");
      }
      return services.convertAnkiWords((done, total) =>
        setProgress(`${fmt(done)} of ${fmt(total)}`),
      );
    },
    onSettled: () => setProgress(null),
    onSuccess: async () => {
      for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return { run, progress };
}

/** The word's article apart, muted: "de fiets". */
function Headword({ text }: { text: string }) {
  const m = /^(de|het|de\/het)\s+(.+)$/.exec(text);
  return (
    <span className="convert-word" lang="nl">
      {m ? (
        <>
          <span className="convert-art">{m[1]}</span> {m[2]}
        </>
      ) : (
        text
      )}
    </span>
  );
}

/** One of the learner's words: the Anki card, then the Vuurtoren word. */
function ConvertExampleCards({ example }: { example: ConvertExample }) {
  const { before, after } = example;
  return (
    <div className="convert-example">
      <div className="convert-card">
        <span className="convert-word" lang="nl">
          {before.word}
        </span>
        {before.gloss ? <span className="convert-gloss">{before.gloss}</span> : null}
        <span className="convert-note">
          {before.picture ? "your picture · " : ""}
          {fmt(before.reviews)} {before.reviews === 1 ? "review" : "reviews"}
        </span>
      </div>
      <span className="convert-arrow" aria-label="becomes">
        →
      </span>
      <div className="convert-card convert-after">
        <Headword text={after.headword} />
        {after.gloss ? <span className="convert-gloss">{after.gloss}</span> : null}
        <span className="convert-note">
          {after.sentence ? "a sentence · " : ""}
          <Volume2 size={13} aria-label="recordings" />
          {after.picture ? " · your picture" : ""}
        </span>
      </div>
    </div>
  );
}

/** The four counts. */
function Counts({ c }: { c: AnkiConversion }) {
  return (
    <div className="convert-counts">
      <div>
        <b>{fmt(c.words)}</b>
        <span>Anki words Vuurtoren knows</span>
      </div>
      <div>
        <b>{fmt(c.levels)}</b>
        <span>go into your levels</span>
      </div>
      {c.rarer ? (
        <div>
          <b>{fmt(c.rarer)}</b>
          <span>rarer words, their own category</span>
        </div>
      ) : null}
      {c.stay ? (
        <div>
          <b>{fmt(c.stay)}</b>
          <span>other notes stay as they are</span>
        </div>
      ) : null}
    </div>
  );
}

/** Settings → Your words: shown while there are Anki words to convert. */
export function ConvertAnki() {
  const conversion = useAnkiConversion();
  const { run, progress } = useConvert(true);
  const [later, setLater] = useState(() => readLocalJSON(LATER) === true);
  const c = conversion.data;
  if (run.isSuccess)
    return (
      <section className="stack" aria-labelledby="convert-h">
        <h3 className="settings-h3" id="convert-h">
          Make my Anki words Vuurtoren words
        </h3>
        <p role="status" className="convert-done">
          {fmt(run.data)}{" "}
          {run.data === 1 ? "word is a Vuurtoren word" : "words are Vuurtoren words"} now. Backup
          saved in Downloads.
        </p>
      </section>
    );
  if (!c?.words) return null;
  return (
    <section className="stack" aria-labelledby="convert-h">
      <h3 className="settings-h3" id="convert-h">
        Make my Anki words Vuurtoren words
      </h3>
      {later ? (
        <div>
          <Button
            onClick={() => {
              writeLocalJSON(LATER, false);
              setLater(false);
            }}
          >
            Show
          </Button>
        </div>
      ) : (
        <>
          <Counts c={c} />
          {c.example ? (
            <>
              <span className="convert-label">For example, one of yours</span>
              <ConvertExampleCards example={c.example} />
            </>
          ) : null}
          <ul className="convert-list">
            <li>Your reviews and schedule stay.</li>
            <li>Vuurtoren&rsquo;s meaning, sentence and recordings. Your pictures stay.</li>
            <li>
              The words go into the level decks. There new words come in order of how common they
              are, and your level counts them.
            </li>
            <li>A backup of your decks is saved first.</li>
          </ul>
          <div className="convert-actions">
            <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? <Spinner label="Converting" /> : null}
              {run.isPending && progress ? progress : `Convert ${fmt(c.words)} words`}
            </Button>
            <Button
              disabled={run.isPending}
              onClick={() => {
                writeLocalJSON(LATER, true);
                setLater(true);
              }}
            >
              Not now
            </Button>
          </div>
          {run.isError ? (
            <p role="alert" className="error-text" style={{ margin: 0 }}>
              {errorText(run.error)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
