import { useEffect, useId, useRef, useState } from "react";
import { Button, LogoMark, Spinner } from "@app/ui";
import type { DesktopBridge } from "./bridge.js";

interface ConnectProps {
  bridge: DesktopBridge;
  /** The user asked to change the server (`?connect`): never open the saved one by itself. */
  changing: boolean;
}

type Phase =
  | { kind: "loading" }
  /** A saved server is being checked and opened. */
  | { kind: "opening"; host: string }
  | { kind: "form" };

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const messageOf = (e: unknown): string =>
  typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong. Try again.";

/**
 * "Connect to a Kenning server" in the desktop app (docs/desktop.md); the app itself starts on
 * this computer only, so this screen is the advanced route. The address is checked
 * (`/api/health`) by the app, then the window opens the server itself, which shows its own
 * sign-in screen when it needs one. Later starts open the saved server straight away; if it
 * does not answer, this screen says so and offers to retry, pick another, or go back to using
 * Kenning on this computer.
 */
export function ConnectScreen({ bridge, changing }: ConnectProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [saved, setSaved] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { input: useId(), error: useId(), title: useId() };

  /** Check the address, then hand the window over to the server. */
  const open = async (url: string): Promise<boolean> => {
    try {
      const { url: normalized } = await bridge.checkServer(url);
      await bridge.connect(normalized);
      return true;
    } catch (e) {
      setProblem(messageOf(e));
      return false;
    }
  };

  useEffect(() => {
    let live = true;
    void bridge
      .info()
      .catch(() => ({ serverUrl: null }))
      .then(async ({ serverUrl }) => {
        if (!live) return;
        setSaved(serverUrl);
        setAddress(serverUrl ? hostOf(serverUrl) : "");
        if (serverUrl && !changing) {
          setPhase({ kind: "opening", host: hostOf(serverUrl) });
          if (await open(serverUrl)) return;
        }
        if (live) setPhase({ kind: "form" });
      });
    return () => {
      live = false;
    };
    // Runs once per mount: `open` only uses the bridge and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, changing]);

  useEffect(() => {
    if (phase.kind === "form") inputRef.current?.focus();
  }, [phase.kind]);

  const submit = async (): Promise<void> => {
    if (pending) return;
    if (!address.trim()) {
      setProblem("Enter the address of your Kenning server.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setProblem(null);
    const ok = await open(address);
    if (!ok) {
      setPending(false);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  };

  if (phase.kind !== "form") {
    return (
      <div className="signin">
        <main className="signin-main connect-opening" aria-busy="true">
          <LogoMark size={56} />
          <p className="signin-lede">
            <Spinner label="Connecting" />{" "}
            {phase.kind === "opening" ? `Opening ${phase.host}…` : "Starting…"}
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="signin">
      <main className="signin-main" aria-labelledby={ids.title}>
        <header className="signin-brand">
          <LogoMark size={56} />
          <p className="signin-name" aria-hidden="true">
            kenning
          </p>
        </header>
        <section className="signin-card">
          <h1 id={ids.title} className="signin-title">
            Connect to your Kenning server
          </h1>
          <p className="signin-lede">
            Your texts, words and progress live on your server. Enter the address you open in the
            browser.
          </p>
          <form
            className="signin-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="k-field">
              <label className="k-label" htmlFor={ids.input}>
                Server address
              </label>
              <input
                ref={inputRef}
                id={ids.input}
                name="server"
                className="k-input signin-input"
                type="url"
                inputMode="url"
                placeholder="kenning.example.com"
                autoComplete="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={address}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? ids.error : undefined}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div id={ids.error} aria-live="polite">
              {problem ? (
                <p className="signin-message" role="alert">
                  {problem}
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              variant="primary"
              className="signin-submit"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending ? <Spinner label="Connecting" /> : null}
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </form>
          {saved && changing ? (
            <button
              type="button"
              className="signin-switch"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void open(saved).then((ok) => ok || setPending(false));
              }}
            >
              Back to {hostOf(saved)}
            </button>
          ) : null}
        </section>
        <section className="signin-card connect-offline" aria-labelledby={`${ids.title}-offline`}>
          <h2 id={`${ids.title}-offline`} className="connect-offline-title">
            Use on this computer only
          </h2>
          <p className="signin-lede">
            No server needed: your data stays in a file on this computer and Kenning works offline.
          </p>
          <Button
            disabled={pending}
            onClick={() => {
              setPending(true);
              void bridge.useLocal().catch((e: unknown) => {
                setProblem(messageOf(e));
                setPending(false);
              });
            }}
          >
            Use on this computer
          </Button>
        </section>
      </main>
    </div>
  );
}
