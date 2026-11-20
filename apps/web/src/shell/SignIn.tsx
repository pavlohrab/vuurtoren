import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, LogoMark, Spinner } from "@app/ui";
import type { AuthMethod, Credentials, SignInResult } from "../auth/client.js";

interface SignInProps {
  /** What the server accepts (from /api/health). */
  methods: readonly AuthMethod[];
  signIn: (c: Credentials) => Promise<SignInResult>;
  onSignedIn: (user: string | null) => void;
  /** "expired": shown over the app after a 401; the page stays where it was. */
  reason?: "expired" | undefined;
  /** Prefill the username (re-sign-in). */
  defaultUser?: string | null | undefined;
}

type Problem = { kind: "invalid" | "unavailable" | "refused"; message: string } | null;

/** "0:42" style countdown. */
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The sign-in screen for a public Vuurtoren server. Calm and plain: one card, two fields,
 * clear errors. Works with password managers (form, names, autocomplete) and the keyboard
 * (Enter submits, the show/hide toggle is a real button, errors move focus back).
 */
export function SignInScreen({ methods, signIn, onSignedIn, reason, defaultUser }: SignInProps) {
  const canPassword = methods.includes("password");
  const [mode, setMode] = useState<AuthMethod>(canPassword ? "password" : "token");
  const [user, setUser] = useState(defaultUser ?? "");
  const [secret, setSecret] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const userRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  const ids = { user: useId(), secret: useId(), error: useId(), lede: useId() };

  const waitLeft = waitUntil === null ? 0 : Math.max(0, Math.ceil((waitUntil - now) / 1000));
  useEffect(() => {
    if (waitUntil === null) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= waitUntil) {
        setWaitUntil(null);
        secretRef.current?.focus();
      }
    }, 250);
    return () => clearInterval(t);
  }, [waitUntil]);

  useEffect(() => {
    (mode === "password" && !defaultUser ? userRef : secretRef).current?.focus();
  }, [mode, defaultUser]);

  const submit = async (): Promise<void> => {
    if (pending || waitLeft > 0) return;
    if (mode === "password" && !user.trim()) {
      setProblem({ kind: "invalid", message: "Enter your username." });
      userRef.current?.focus();
      return;
    }
    if (!secret) {
      setProblem({
        kind: "invalid",
        message: mode === "password" ? "Enter your password." : "Enter the access token.",
      });
      secretRef.current?.focus();
      return;
    }
    setPending(true);
    setProblem(null);
    const result = await signIn(
      mode === "password" ? { user: user.trim(), password: secret } : { token: secret.trim() },
    ).catch((): SignInResult => ({
      ok: false,
      kind: "unavailable",
      message: "Something went wrong. Try again.",
    }));
    setPending(false);
    if (result.ok) {
      setSecret("");
      onSignedIn(result.user);
      return;
    }
    if (result.kind === "rate-limited") {
      const n = Date.now();
      setNow(n);
      setWaitUntil(n + (result.retryAfter ?? 30) * 1000);
      setProblem(null);
      return;
    }
    setProblem({ kind: result.kind, message: result.message });
    if (result.kind === "invalid") {
      // Keep the username, select the password so the next try is one keystroke away.
      requestAnimationFrame(() => secretRef.current?.select());
      secretRef.current?.focus();
    }
  };

  const invalid = problem?.kind === "invalid";
  const describedBy = problem || waitLeft > 0 ? ids.error : undefined;

  return (
    <div className={reason === "expired" ? "signin signin--overlay" : "signin"}>
      <main className="signin-main" aria-labelledby={`${ids.lede}-title`}>
        <header className="signin-brand">
          <LogoMark size={56} />
          <p className="signin-name" aria-hidden="true">
            vuurtoren
          </p>
          <p className="signin-pitch">
            Read Dutch with the words you already know: Vuurtoren uses your Anki decks to find texts
            you can read and the next words worth learning.
          </p>
        </header>
        <section className="signin-card">
          <h1 id={`${ids.lede}-title`} className="signin-title">
            {reason === "expired" ? "Sign in again" : "Sign in"}
          </h1>
          <p id={ids.lede} className="signin-lede">
            {reason === "expired"
              ? "Your session has ended. Sign in to continue where you were; nothing on this page is lost."
              : "Your texts, words and progress are kept on this server."}
          </p>

          <form
            className="signin-form"
            method="post"
            action="/api/auth/login"
            noValidate
            aria-describedby={ids.lede}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === "password" ? (
              <div className="k-field">
                <label className="k-label" htmlFor={ids.user}>
                  Username
                </label>
                <input
                  ref={userRef}
                  id={ids.user}
                  name="username"
                  className="k-input signin-input"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={user}
                  aria-invalid={invalid && !user.trim() ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(e) => setUser(e.target.value)}
                />
              </div>
            ) : null}

            <div className="k-field">
              <label className="k-label" htmlFor={ids.secret}>
                {mode === "password" ? "Password" : "Access token"}
              </label>
              <div className="signin-secret">
                <input
                  ref={secretRef}
                  id={ids.secret}
                  name={mode === "password" ? "password" : "token"}
                  className="k-input signin-input"
                  type={reveal ? "text" : "password"}
                  autoComplete={mode === "password" ? "current-password" : "off"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={secret}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <button
                  type="button"
                  className="signin-reveal"
                  aria-label={reveal ? "Hide password" : "Show password"}
                  aria-pressed={reveal}
                  aria-controls={ids.secret}
                  onClick={() => {
                    setReveal((r) => !r);
                    secretRef.current?.focus();
                  }}
                >
                  {reveal ? (
                    <EyeOff size={16} strokeWidth={1.5} aria-hidden />
                  ) : (
                    <Eye size={16} strokeWidth={1.5} aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <div id={ids.error} aria-live="polite">
              {waitLeft > 0 ? (
                <p className="signin-message" role="alert">
                  Too many attempts. You can try again in {clock(waitLeft)}.
                </p>
              ) : problem ? (
                <p className="signin-message" role="alert">
                  {problem.message}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              variant="primary"
              className="signin-submit"
              disabled={pending || waitLeft > 0}
              aria-busy={pending || undefined}
            >
              {pending ? <Spinner label="Signing in" /> : null}
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {canPassword && methods.includes("token") ? (
            <button
              type="button"
              className="signin-switch"
              onClick={() => {
                setMode(mode === "password" ? "token" : "password");
                setSecret("");
                setProblem(null);
              }}
            >
              {mode === "password" ? "Use an access token instead" : "Use username and password"}
            </button>
          ) : null}
        </section>
        <p className="signin-foot">
          {mode === "password"
            ? "Forgot the password? Whoever runs this server can set a new one with hash-password."
            : "The token is the VUURTOREN_TOKEN set on the server."}
        </p>
      </main>
    </div>
  );
}
