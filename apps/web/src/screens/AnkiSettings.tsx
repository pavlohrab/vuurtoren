import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { corsConfigLine } from "@app/anki";
import { Button, Input, Spinner } from "@app/ui";
import { useServices } from "../services/context.js";
import type { AnkiStatus, Settings as SettingsData } from "../services/types.js";

interface Props {
  form: SettingsData;
  set: <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => void;
  /** Persist the on-screen settings (the address and key) before testing. */
  persist: (s: SettingsData) => Promise<void>;
  /** Clear the optional API key from the form. */
  clearKey: () => void;
}

/** Advice for each state that is not "connected". */
function Help({ status, denied }: { status: AnkiStatus; denied: boolean }) {
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
        This site is allowed, but AnkiConnect has an API key set. Enter it in the key field above.
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

/** Settings: the Anki section (address, key, deck, connect and test). */
export function AnkiSettings({ form, set, persist, clearKey }: Props) {
  const services = useServices();
  const [denied, setDenied] = useState(false);
  const [status, setStatus] = useState<AnkiStatus | null>(null);
  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");

  // Testing and connecting use the address and key on screen, so they are saved first.
  const test = useMutation({
    mutationFn: async () => {
      await persist(form);
      return services.ankiStatus();
    },
    onSuccess: (s) => {
      setDenied(false);
      setStatus(s);
    },
  });
  const connect = useMutation({
    mutationFn: async () => {
      await persist(form);
      return services.connectAnki();
    },
    onSuccess: (r) => {
      setDenied(r.denied);
      setStatus(r.status);
    },
  });
  const busy = test.isPending || connect.isPending;
  const error = test.error ?? connect.error;

  return (
    <>
      <h2 style={{ fontSize: 19 }}>Anki</h2>
      <Input
        label="AnkiConnect address"
        value={form.ankiUrl}
        onChange={(e) => set("ankiUrl", e.target.value)}
      />
      <Input
        label="AnkiConnect key"
        type="password"
        value={form.ankiKey ?? ""}
        hint="Only needed if you set an API key in the AnkiConnect add-on."
        onChange={(e) => {
          if (e.target.value) set("ankiKey", e.target.value);
          else clearKey();
        }}
      />
      <Input
        label="Target deck"
        value={form.targetDeck}
        hint="New cards from the reader are added here."
        onChange={(e) => set("targetDeck", e.target.value)}
      />
      <div className="row">
        <Button variant="primary" onClick={() => connect.mutate()} disabled={busy}>
          {connect.isPending ? <Spinner label="Waiting for Anki" /> : null}
          Connect to Anki
        </Button>
        <Button onClick={() => test.mutate()} disabled={busy}>
          {test.isPending ? <Spinner label="Testing" /> : null}
          Test connection
        </Button>
      </div>
      <p className="k-hint" style={{ margin: 0 }}>
        {connect.isPending
          ? "Switch to Anki: it asks whether to allow this site. Click Yes."
          : "Anki will ask whether to allow this site. Click Yes. Both buttons save your changes first."}
      </p>
      {error ? (
        <span role="alert" className="error-text">
          {message(error)}
        </span>
      ) : status ? (
        <Help status={status} denied={denied} />
      ) : null}
    </>
  );
}
