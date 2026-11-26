/**
 * Settings > Advanced > Server status: what a self-hoster checks first when something is off.
 * Everything is asked from this browser (so Anki's row is the real answer for this device):
 * the open health endpoints of the api (`/api/health`) and the language server (`<nlp>/health`),
 * the data counters, the AnkiConnect status. scripts/doctor.sh does the same from a shell.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Button, useToast } from "@app/ui";
import { formatBytes } from "../../format.js";
import { useServices } from "../../services/context.js";
import { useAppInfo } from "../../shell/AppInfo.js";
import { useDebounced } from "../../useDebounced.js";
import { appVersionLabel } from "../../version.js";

type Tone = "ok" | "warn" | "error" | "pending";

interface ApiHealth {
  authRequired: boolean;
  authMethods?: string[];
}
interface NlpHealth {
  version: string;
  analyzerVersion?: string;
  data?: Record<string, boolean>;
  /** Data packs: installed in the background after the server starts. */
  packs?: { busy: boolean; items: Record<string, { state: string; activity?: string }> };
}

const DATA_NAMES: Record<string, string> = {
  dictionary: "dictionary",
  sentences: "example sentences",
  translation: "translation model",
  grammarExamples: "grammar examples",
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Row {
  label: string;
  tone: Tone;
  value: string;
}

/** The status rows, newest answers first; `nlpUrl` is the address from Advanced. */
export function ServerStatus({ nlpUrl }: { nlpUrl: string }) {
  const { data, account, demo } = useAppInfo();
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  // The page comes from a Vuurtoren server (its sync place and sign-in).
  const server = Boolean(account);
  const nlp = useDebounced(nlpUrl.replace(/\/+$/, ""), 600);

  const api = useQuery({
    queryKey: ["server-status", "api"],
    queryFn: () => getJson<ApiHealth>("/api/health"),
    enabled: server,
    retry: false,
  });
  const lang = useQuery({
    queryKey: ["server-status", "nlp", nlp],
    queryFn: () => getJson<NlpHealth>(`${nlp}/health`),
    enabled: !demo && nlp !== "",
    retry: false,
  });
  const info = useQuery({
    queryKey: ["data-info"],
    queryFn: () => (data ? data.admin.info() : Promise.reject(new Error("no data"))),
    enabled: Boolean(data),
  });
  const anki = useQuery({
    queryKey: ["anki-status"],
    queryFn: () => services.ankiStatus(),
    retry: false,
  });

  const rows: Row[] = [{ label: "Vuurtoren", tone: "ok", value: `${appVersionLabel()} · beta` }];

  if (demo || !data) {
    rows.push({ label: "Your data", tone: "warn", value: "Demo data: nothing is stored." });
  } else {
    const size = info.data
      ? ` · ${formatBytes(info.data.sizeBytes)}, ${info.data.eventCount.toLocaleString()} events`
      : "";
    rows.push(
      data.mode !== "browser"
        ? {
            label: "Your data",
            tone: "ok",
            value: `${data.file?.path ?? (data.mode === "phone" ? "On this phone" : "On this computer")}${size}`,
          }
        : {
            label: "Your data",
            tone: data.persistent && data.persisted !== false ? "ok" : "warn",
            value: `In this browser${data.persistent ? "" : ", in memory only (not saved)"}${size}`,
          },
    );
  }

  if (server) {
    if (api.isPending) rows.push({ label: "Server", tone: "pending", value: "Checking…" });
    else if (api.error) {
      rows.push({ label: "Server", tone: "error", value: `No answer (${why(api.error)})` });
    } else if (api.data) {
      rows.push({ label: "Server", tone: "ok", value: "Sync place and language server" });
      rows.push(
        api.data.authRequired
          ? {
              label: "Sign-in",
              tone: "ok",
              value: `On (${(api.data.authMethods ?? []).join(", ") || "password"})${
                account?.user ? `, signed in as ${account.user}` : ""
              }`,
            }
          : {
              label: "Sign-in",
              tone: "warn",
              value: "Off: anyone who can open this address can use its sync place",
            },
      );
    }
  }

  if (!demo) {
    if (lang.isPending)
      rows.push({ label: "Language server", tone: "pending", value: "Checking…" });
    else if (lang.error) {
      rows.push({
        label: "Language server",
        tone: "error",
        value:
          data?.mode === "desktop"
            ? `Not answering yet (${why(lang.error)})`
            : `Not reachable at ${nlp || "(no address)"} (${why(lang.error)})`,
      });
    } else if (lang.data) {
      const missing = Object.entries(lang.data.data ?? {})
        .filter(([k, present]) => !present && k !== "syntaxdot")
        .map(([k]) => DATA_NAMES[k] ?? k);
      const busy = lang.data.packs?.busy === true;
      const failed = Object.entries(lang.data.packs?.items ?? {}).filter(([, p]) =>
        p.activity?.startsWith("error"),
      );
      rows.push({
        label: "Language server",
        tone: missing.length || failed.length ? (busy ? "pending" : "warn") : "ok",
        value: `${lang.data.version}${
          missing.length
            ? `, ${busy ? "installing language data" : "missing"}: ${missing.join(", ")}`
            : ", all data present"
        }${failed.length ? ` (data pack ${failed.map(([k]) => k).join(", ")} failed)` : ""}${
          lang.data.analyzerVersion ? ` · analyzer ${lang.data.analyzerVersion}` : ""
        }`,
      });
      // The sentence structure's parser: SyntaxDot where it runs (Linux), else spaCy's parse.
      if (lang.data.data && "syntaxdot" in lang.data.data)
        rows.push({
          label: "Sentence structure",
          tone: "ok",
          value: lang.data.data.syntaxdot ? "SyntaxDot" : "spaCy (SyntaxDot runs only on Linux)",
        });
    }
  }

  if (anki.isPending) rows.push({ label: "Anki", tone: "pending", value: "Checking…" });
  else {
    const s = anki.data;
    rows.push({
      label: "Anki",
      tone: s?.connected ? "ok" : "warn",
      value: s?.connected
        ? `Reachable from this browser${s.version ? `, AnkiConnect ${s.version}` : ""}`
        : `Not reachable from this browser (${s?.state ?? why(anki.error)}): see Your words`,
    });
  }

  rows.push(
    window.isSecureContext
      ? { label: "Secure context", tone: "ok", value: "Yes (https or localhost)" }
      : {
          label: "Secure context",
          tone: "error",
          value: "No: plain http on another address; storage and Anki may fail",
        },
  );

  const recheck = () => {
    void qc.invalidateQueries({ queryKey: ["server-status"] });
    void qc.invalidateQueries({ queryKey: ["data-info"] });
    void qc.invalidateQueries({ queryKey: ["anki-status"] });
  };
  const copy = async () => {
    const text = rows.map((r) => `${r.label}: ${r.value}`).join("\n");
    try {
      await navigator.clipboard.writeText(`${text}\nBrowser: ${navigator.userAgent}\n`);
      toast("Status copied");
    } catch {
      toast("Could not copy", "Select the rows and copy them instead.");
    }
  };

  return (
    <section className="server-status" aria-labelledby="server-status-h">
      <div className="server-status-head">
        <h3 id="server-status-h">Server status</h3>
        <div className="server-status-actions">
          <Button size="sm" variant="ghost" onClick={recheck}>
            Check again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copy()}>
            Copy
          </Button>
        </div>
      </div>
      <dl className="server-status-list">
        {rows.map((r) => (
          <div key={r.label} className="server-status-row" data-tone={r.tone}>
            <dt>
              <span className="server-status-dot" aria-hidden />
              {r.label}
            </dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {!demo && nlp && lang.data?.data?.["syntaxdot"] === false ? (
        <SyntaxDotDownload
          nlp={nlp}
          onDone={() => void qc.invalidateQueries({ queryKey: ["server-status", "nlp"] })}
        />
      ) : null}
      {/* Speaking listens on your own computer only, never on a hosted server. */}
      {!demo && nlp && isLocal(nlp) && lang.data?.data?.["listen"] === false ? (
        <SpeakingDownload
          nlp={nlp}
          onDone={() => void qc.invalidateQueries({ queryKey: ["server-status", "nlp"] })}
        />
      ) : null}
    </section>
  );
}

interface SyntaxDotStatus {
  supported: boolean;
  installed: boolean;
  state: "idle" | "downloading" | "done" | "failed";
  step: string;
  received: number;
  error: string | null;
}

/**
 * SX4: on a Linux computer, SyntaxDot (the better sentence structure) comes from here instead
 * of four commands in the install guide. Elsewhere it can't run, and this says nothing.
 */
export function SyntaxDotDownload({ nlp, onDone }: { nlp: string; onDone: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["server-status", "syntaxdot", nlp],
    queryFn: () => getJson<SyntaxDotStatus>(`${nlp}/admin/syntaxdot`),
    retry: false,
    refetchInterval: (q) => (q.state.data?.state === "downloading" ? 2000 : false),
  });
  const s = status.data;
  const done = s?.state === "done" || s?.installed;
  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);
  if (!s?.supported || s.installed) return null;
  const start = async () => {
    const r = await fetch(`${nlp}/admin/syntaxdot`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (r.ok) qc.setQueryData(["server-status", "syntaxdot", nlp], await r.json());
  };
  return (
    <div className="syntaxdot-download stack" style={{ gap: 6 }}>
      {s.state === "downloading" ? (
        <p className="k-hint" role="status" style={{ margin: 0 }}>
          Downloading {s.step || "SyntaxDot"}… {formatBytes(s.received)}
        </p>
      ) : (
        <>
          <p className="k-hint" style={{ margin: 0 }}>
            SyntaxDot gets the sentence structure right more often than spaCy. It runs on this
            computer. The download is about 250 MB, 620 MB unpacked.
          </p>
          <div className="row">
            <Button size="sm" onClick={() => void start()}>
              Download SyntaxDot
            </Button>
          </div>
        </>
      )}
      {s.state === "failed" && s.error ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {s.error}
        </p>
      ) : null}
    </div>
  );
}

/** The language server runs on this computer (the desktop app's helper). */
function isLocal(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url, location.href).hostname);
  } catch {
    return false;
  }
}

interface PackItem {
  state: string;
  activity: string | null;
}

/**
 * Speaking ("Say this sentence") needs speech recognition, the asr-nl pack (about 94 MB). Nobody
 * gets it unasked: this fetches it on this computer's language server when you turn it on.
 */
export function SpeakingDownload({ nlp, onDone }: { nlp: string; onDone: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["server-status", "packs", nlp],
    queryFn: () => getJson<{ items: Record<string, PackItem> }>(`${nlp}/admin/packs`),
    retry: false,
    refetchInterval: (q) => (q.state.data?.items["asr-nl"]?.activity ? 2000 : false),
  });
  const item = status.data?.items["asr-nl"];
  const done = item?.state === "ok";
  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);
  if (!item || done) return null;
  const busy = !!item.activity && !item.activity.startsWith("error");
  const start = async () => {
    const r = await fetch(`${nlp}/admin/packs/asr-nl`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (r.ok) qc.setQueryData(["server-status", "packs", nlp], await r.json());
  };
  return (
    <div className="syntaxdot-download stack" style={{ gap: 6 }}>
      {busy ? (
        <p className="k-hint" role="status" style={{ margin: 0 }}>
          Downloading speech recognition…
        </p>
      ) : (
        <>
          <p className="k-hint" style={{ margin: 0 }}>
            Practice can ask you to say a sentence out loud. This computer listens itself, so it
            needs speech recognition first, about 94 MB.
          </p>
          <div className="row">
            <Button size="sm" onClick={() => void start()}>
              Turn on speaking
            </Button>
          </div>
        </>
      )}
      {item.activity?.startsWith("error") ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {item.activity.slice("error: ".length)}
        </p>
      ) : null}
    </div>
  );
}
