import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { corsConfigLine } from "@app/anki";
import { Button, Spinner } from "@app/ui";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { isNoDecksError } from "../../services/profileErrors.js";
import type { AnkiStatus } from "../../services/types.js";
import { ErrorNotice } from "../../shell/ErrorNotice.js";
import { runAnkiSync, useAnkiSync } from "../../shell/ankiSync.js";
import { NoDecksHelp } from "../onboarding/NoDecksHelp.js";

/** Advice for each state that is not "connected" (also used by onboarding). */
export function AnkiConnectionHelp({ status, denied }: { status: AnkiStatus; denied: boolean }) {
  const origin = window.location.origin;
  if (status.state === "connected") {
    return (
      <p role="status" style={{ margin: 0 }}>
        Connected{status.version ? `, AnkiConnect version ${status.version}` : ""}.
      </p>
    );
  }
  if (status.state === "not-running") {
    return (
      <p role="alert" className="error-text" style={{ margin: 0 }}>
        Anki is not running, or the AnkiConnect add-on is not installed. Open Anki (keep it open)
        and install the add-on with code 2055492159 (Tools, Add-ons, Get Add-ons), then restart Anki
        and try again.
      </p>
    );
  }
  if (status.state === "needs-key") {
    return (
      <p role="alert" className="error-text" style={{ margin: 0 }}>
        This site is allowed, but AnkiConnect has an API key set. Enter it under Settings, Advanced.
      </p>
    );
  }
  if (status.state === "busy") {
    return (
      <p role="alert" className="error-text" style={{ margin: 0 }}>
        Anki did not answer in time. Look for a dialog open in Anki and close it.
      </p>
    );
  }
  return (
    <div role="alert" className="stack" style={{ gap: 8 }}>
      <p className="error-text" style={{ margin: 0 }}>
        {denied
          ? "Anki said no to this site."
          : "Anki is running, but this site is not allowed yet."}{" "}
        Use Connect to Anki, or allow it by hand: in Anki open Tools, Add-ons, AnkiConnect, Config
        and make sure it contains this line, then restart Anki:
      </p>
      <code style={{ userSelect: "all", overflowWrap: "anywhere" }}>{corsConfigLine(origin)}</code>
    </div>
  );
}

/**
 * Settings > Language & decks, top: is Anki reachable? Connect (Anki asks to allow this site),
 * check again, and sync the decks. The address and key are under Advanced.
 */
export function AnkiConnection() {
  const services = useServices();
  const qc = useQueryClient();
  const [denied, setDenied] = useState(false);
  const status = useQuery({
    queryKey: ["anki-status"],
    queryFn: () => services.ankiStatus(),
    retry: false,
  });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const connect = useMutation({
    mutationFn: () => services.connectAnki(),
    onSuccess: (r) => {
      setDenied(r.denied);
      qc.setQueryData(["anki-status"], r.status);
    },
  });
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const sync = useMutation({
    mutationFn: () => {
      setSyncLog([]);
      return runAnkiSync(services, qc, (m) => setSyncLog((l) => [...l, m]));
    },
  });
  const shared = useAnkiSync();
  const syncing = sync.isPending || shared.running;
  const st = status.data;
  const connected = st?.state === "connected";
  const s = summary.data;
  return (
    <div className="anki-conn" aria-label="Anki connection" role="group">
      <div className="anki-conn-head">
        <span className="anki-conn-dot" data-ok={connected || undefined} aria-hidden />
        <div className="anki-conn-text">
          <strong>
            {status.isPending
              ? "Checking Anki…"
              : connected
                ? `Anki is connected${st?.version ? ` (AnkiConnect ${st.version})` : ""}`
                : "Anki is not connected"}
          </strong>
          <span className="k-hint">
            {s?.lastSync
              ? `Last synced ${new Date(s.lastSync).toLocaleString("en")}: ${s.known.toLocaleString("en")} known, ${s.learning.toLocaleString("en")} learning.`
              : "Not synced yet. Sync to read which words you know."}
          </span>
        </div>
        <div className="anki-conn-actions">
          {connected ? (
            <Button variant="primary" onClick={() => sync.mutate()} disabled={syncing}>
              {syncing ? <Spinner label="Syncing" /> : null}
              Sync from Anki
            </Button>
          ) : (
            <Button variant="primary" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? <Spinner label="Waiting for Anki" /> : null}
              Connect to Anki
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => void status.refetch()}
            disabled={status.isFetching}
          >
            Check again
          </Button>
        </div>
      </div>
      {connect.isPending ? (
        <p className="k-hint" style={{ margin: 0 }}>
          Switch to Anki: it asks whether to allow this site. Click Yes.
        </p>
      ) : null}
      {st && !connected ? <AnkiConnectionHelp status={st} denied={denied} /> : null}
      {status.isError ? (
        <span role="alert" className="error-text">
          {errorText(status.error)}
        </span>
      ) : null}
      {sync.isPending || (syncLog.length > 0 && !sync.isError && !sync.isSuccess) ? (
        <ul className="progress-log" aria-live="polite">
          {syncLog.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      {sync.isError && isNoDecksError(sync.error) ? (
        <NoDecksHelp />
      ) : sync.isError ? (
        <ErrorNotice
          error={sync.error}
          title="The sync did not finish."
          settingsLink={false}
          onRetry={() => sync.mutate()}
        />
      ) : sync.isSuccess ? (
        <p role="status" style={{ margin: 0 }}>
          Synced. {sync.data.known.toLocaleString("en")} words known,{" "}
          {sync.data.learning.toLocaleString("en")} in progress, about{" "}
          {sync.data.vocabEstimate.toLocaleString("en")} in your vocabulary.
        </p>
      ) : null}
    </div>
  );
}
