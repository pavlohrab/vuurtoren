/**
 * Voice on a phone (Settings → Reading → Voice): the recordings pack (`audio-nl`, the recorded
 * words, example sentences and stories in both voices, about 230 MB) kept on the device, so a
 * phone without a server says words with the recordings. Without it the phone's own Dutch voice
 * speaks. Like the dictionary, it comes from the connected server when there is one, else from
 * the data host; on Wi-Fi only unless mobile data is allowed; a stopped download goes on from
 * where it was. "Test the voice" plays a word and says which voice it used.
 *
 * The test is shown everywhere; the download only on a device with such a pack (phones).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { clipId, wordClipText } from "@app/anki";
import { Button } from "@app/ui";
import { browserPlayer, say } from "../../audio/play.js";
import { formatBytes } from "../../format.js";
import { currentDevice } from "../../platform/index.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { readLocal } from "../../storage/local.js";
import { ownVoiceInUse } from "../../platform/ownVoice.js";

/** The same choice as the dictionary's: "1" allows mobile data for the language data. */
const MOBILE_DATA_KEY = "vuurtoren-packs-mobile-data";

function onMobileData(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return c?.type === "cellular";
}

/** The word the test says: a starter word with a recording in both voices. */
const TEST_WORD = { word: "fiets", article: "de" };

export function VoiceTest({ rate }: { rate: number }) {
  const services = useServices();
  const [result, setResult] = useState<"clip" | "voice" | "none" | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const text = wordClipText(TEST_WORD.word, TEST_WORD.article);
      const clip = await clipId("word", text);
      setResult(
        await say(
          { clip, text },
          rate,
          browserPlayer((id) => services.audioClip(id)),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <Button onClick={() => void test()} disabled={busy}>
          Test the voice
        </Button>
      </div>
      {result ? (
        <p className="k-hint" role="status" style={{ margin: 0 }}>
          {result === "clip"
            ? "That was a recording."
            : result === "voice"
              ? ownVoiceInUse()
                ? "That was Vuurtoren's own Dutch voice. Words without a recording sound like this."
                : "That was your device's own Dutch voice. Words without a recording sound like this."
              : "Nothing played, because there is no recording here and your device has no Dutch voice. You can add one in your device's speech settings. On Android it's in Settings → System → Languages → Text-to-speech."}
        </p>
      ) : null}
    </div>
  );
}

/**
 * With `autoStart` (the first start), the download begins by itself once the dictionary is in,
 * on Wi-Fi only unless mobile data is allowed: a new phone gets the recordings without a visit to
 * Settings.
 */
export function RecordingsPack({ autoStart = false }: { autoStart?: boolean }) {
  const pack = currentDevice().bridge?.audio ?? null;
  const dictionary = currentDevice().bridge?.dictionary ?? null;
  const services = useServices();
  const qc = useQueryClient();
  const install = useMutation({
    mutationFn: async () => pack!.install((await services.packSource?.()) ?? null),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["audio-pack"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => pack!.remove(),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["audio-pack"] }),
  });
  const status = useQuery({
    queryKey: ["audio-pack"],
    queryFn: () => pack!.status(),
    enabled: !!pack,
    refetchInterval: (q) => (install.isPending || q.state.data?.downloading ? 500 : false),
  });
  // The dictionary first (small, meanings matter more), then the recordings.
  const dict = useQuery({
    queryKey: ["dictionary-pack"],
    queryFn: () => dictionary!.status(),
    enabled: autoStart && !!dictionary,
    refetchInterval: (q) => (autoStart && !q.state.data?.installed ? 2000 : false),
  });
  const started = useRef(false);
  const dictReady = !dictionary || dict.data?.installed === true;
  const missing = !!status.data && !status.data.installed && !status.data.downloading;
  const mobileOk = readLocal(MOBILE_DATA_KEY) === "1";
  useEffect(() => {
    if (!autoStart || started.current || !missing || !dictReady) return;
    if ((!mobileOk && onMobileData()) || navigator.onLine === false) return;
    started.current = true;
    install.mutate();
  }, [autoStart, missing, dictReady, mobileOk, install]);
  if (!pack || !status.data) return null;
  const s = status.data;
  const size = formatBytes(s.download || s.bytes);
  const received = s.received ?? 0;
  const busy = install.isPending || !!s.downloading;
  const waitingForWifi = readLocal(MOBILE_DATA_KEY) !== "1" && onMobileData();
  return (
    <section className="stack" aria-labelledby="audio-pack-h" style={{ gap: 8 }}>
      <h4 className="settings-h4" id="audio-pack-h">
        Recordings on this phone
      </h4>
      {s.installed ? (
        <>
          <p className="k-hint" style={{ margin: 0 }}>
            The recordings are on this phone ({formatBytes(s.bytes)}), so words and sentences play
            even without a server.
          </p>
          <div className="row">
            <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove the recordings
            </Button>
          </div>
        </>
      ) : busy ? (
        <div role="status" className="stack" style={{ gap: 4 }}>
          <span>
            {received > 0
              ? `Downloading the recordings: ${formatBytes(received)} of ${size}`
              : `Starting the download (${size})…`}
          </span>
          <progress
            className="k-progress"
            max={s.download || 1}
            value={received}
            aria-label="Recordings download"
          />
        </div>
      ) : (
        <>
          <p className="k-hint" style={{ margin: 0 }}>
            These are the recorded words, sentences and stories, in both voices. Without them your
            phone reads with its own Dutch voice.
          </p>
          {install.isError ? (
            <p className="error-text" role="alert" style={{ margin: 0 }}>
              The recordings did not download. Check the connection and try again.
              <small style={{ display: "block" }}>{errorText(install.error)}</small>
            </p>
          ) : null}
          {waitingForWifi ? (
            <p className="k-hint" style={{ margin: 0 }}>
              You are on mobile data, and this is a big download.
            </p>
          ) : null}
          <div className="row">
            <Button onClick={() => install.mutate()}>
              {received > 0
                ? `Go on with the download (${formatBytes(received)} of ${size})`
                : `Download the recordings (~${size})`}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
