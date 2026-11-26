/**
 * The feedback button (FB1, mock `.plan/mocks/mock-feedback.html`). One sheet on a phone, a panel
 * on the right on a computer (where the word card opens), with "Point at it". Ways in: the edge
 * tab of test builds, a shake on the phone, Ctrl+Shift+F and the sidebar on a computer, Settings,
 * and "Tell Pavlo" on every error message. Pavlo's replies come back as a toast and stay in the
 * sheet.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Button, useToast } from "@app/ui";
import { MessageSquareWarning, Mic, Square, X } from "lucide-react";
import { currentDevice } from "../platform/index.js";
import { appVersionLabel } from "../version.js";
import {
  canRecord,
  cropAround,
  describeElement,
  record,
  screenshot,
  type Recorder,
} from "./capture.js";
import {
  deviceLine,
  feedbackOn,
  fetchReplies,
  flushQueue,
  markRepliesRead,
  newReport,
  recentErrors,
  savedReplies,
  submit,
  testBuild,
  type Reply,
} from "./feedback.js";
import "./feedback.css";

interface OpenOptions {
  /** The error message the user was looking at ("Tell Pavlo"). */
  error?: string;
}

interface FeedbackApi {
  open: (opts?: OpenOptions) => void;
  on: boolean;
}

const FeedbackContext = createContext<FeedbackApi>({ open: () => undefined, on: false });

export const useFeedback = (): FeedbackApi => useContext(FeedbackContext);

/** How long Undo stays before the report goes. */
const UNDO_MS = 4000;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const on = feedbackOn();
  const device = currentDevice();
  // The sheet on a phone and in a narrow window; the panel on a computer.
  const phone =
    device.kind === "android" ||
    (typeof matchMedia === "function" && matchMedia("(max-width: 700px)").matches);
  const toast = useToast();
  const [state, setState] = useState<{ shot: Blob | null; error?: string } | null>(null);
  const [unread, setUnread] = useState(() => savedReplies().filter((r) => !r.read).length);

  // Read through a ref, so `open` stays the same while the sheet opens and closes (the
  // effects below that use it don't start over each time).
  const openNow = useRef(false);
  useEffect(() => {
    openNow.current = state !== null;
  }, [state]);
  const open = useCallback(
    (opts: OpenOptions = {}) => {
      if (!on || openNow.current) return;
      // The picture first, so it shows the screen and not the sheet.
      void screenshot().then((shot) =>
        setState({ shot, ...(opts.error ? { error: opts.error } : {}) }),
      );
    },
    [on],
  );

  // Ctrl+Shift+F anywhere on a computer.
  useEffect(() => {
    if (!on || phone) return;
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [on, phone, open]);

  // A shake on the phone asks first, so a bumpy tram doesn't open a form.
  useEffect(() => {
    if (!on || !phone || typeof DeviceMotionEvent === "undefined") return;
    let hits: number[] = [];
    let quiet = 0;
    const motion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const g = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const now = Date.now();
      if (g < 25 || now < quiet) return;
      hits = [...hits.filter((t) => now - t < 1000), now];
      if (hits.length >= 3) {
        hits = [];
        quiet = now + 10_000;
        toast("Shook the phone?", undefined, { label: "Send feedback", onAct: () => open() });
      }
    };
    window.addEventListener("devicemotion", motion);
    return () => window.removeEventListener("devicemotion", motion);
  }, [on, phone, toast, open]);

  // Kept reports go when the device is online; Pavlo's replies come in now and then.
  useEffect(() => {
    if (!on) return;
    const flush = () => void flushQueue();
    const ask = () =>
      void fetchReplies()
        .then((news) => {
          if (!news.length) return;
          setUnread(savedReplies().filter((r) => !r.read).length);
          toast("Pavlo replied", news[news.length - 1]!.text.slice(0, 120), {
            label: "Read",
            onAct: () => open(),
          });
        })
        .catch(() => undefined);
    flush();
    ask();
    window.addEventListener("online", flush);
    const t = window.setInterval(ask, 15 * 60_000);
    return () => {
      window.removeEventListener("online", flush);
      window.clearInterval(t);
    };
  }, [on, toast, open]);

  const api = useMemo(() => ({ open, on }), [open, on]);
  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {on && phone && testBuild() && !state ? (
        <button type="button" className="fb-edge" data-feedback-skip onClick={() => open()}>
          Feedback
        </button>
      ) : null}
      {state ? (
        <FeedbackForm
          phone={phone}
          shot={state.shot}
          {...(state.error ? { error: state.error } : {})}
          unread={unread}
          onClose={() => setState(null)}
          onRead={() => {
            markRepliesRead();
            setUnread(0);
          }}
          onSent={(how) => {
            setState(null);
            toast(how === "kept" ? "Sends when you're online." : "Sent. Thank you.");
          }}
          onUndoable={(go) => {
            setState(null);
            let undone = false;
            toast("Sending…", undefined, { label: "Undo", onAct: () => (undone = true) });
            window.setTimeout(() => {
              if (!undone) void go();
            }, UNDO_MS);
          }}
        />
      ) : null}
    </FeedbackContext.Provider>
  );
}

type PictureMode = "point" | "window" | "none";

function FeedbackForm({
  phone,
  shot,
  error,
  unread,
  onClose,
  onRead,
  onSent,
  onUndoable,
}: {
  phone: boolean;
  shot: Blob | null;
  error?: string;
  unread: number;
  onClose: () => void;
  onRead: () => void;
  onSent: (how: "sent" | "kept") => void;
  onUndoable: (go: () => Promise<void>) => void;
}) {
  const screen = useRouterState({ select: (s) => s.location.href });
  const toast = useToast();
  const [text, setText] = useState("");
  const [picture, setPicture] = useState<Blob | null>(shot);
  const [mode, setMode] = useState<PictureMode>(shot ? (phone ? "window" : "window") : "none");
  const [picked, setPicked] = useState<{ name: string; crop: Blob | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [withErrors, setWithErrors] = useState(true);
  const [replies, setReplies] = useState(true);
  const [voice, setVoice] = useState<Blob | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kind = currentDevice().kind;
  const pictureUrl = useObjectUrl(
    mode === "point" ? (picked?.crop ?? null) : mode === "window" ? picture : null,
  );
  const old = savedReplies();

  useEffect(() => {
    if (unread) onRead();
  }, [unread, onRead]);

  // Esc closes (not while pointing: there it stops pointing).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picking) setPicking(false);
      else onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picking, onClose]);

  const send = () => {
    const report = newReport({
      text,
      screen,
      kind,
      userAgent: navigator.userAgent,
      picked: mode === "point" ? picked?.name : undefined,
      replies,
      error,
    });
    if (!withErrors) report.errors = [];
    if (!text.trim() && !voice && mode === "none") {
      setErr("Say what went wrong first.");
      return;
    }
    const files = {
      screenshot: mode === "point" ? (picked?.crop ?? null) : mode === "window" ? picture : null,
      voice,
    };
    onUndoable(async () => {
      try {
        onSent(await submit(report, files));
      } catch (e) {
        toast("Feedback not sent", e instanceof Error ? e.message : String(e));
      }
    });
  };

  const facts = [appVersionLabel(), deviceLine(navigator.userAgent, kind)];
  const lastError = error ?? recentErrors()[0];

  const body = (
    <>
      {old.length ? <Replies replies={old} /> : null}
      {!phone ? (
        <div className="fb-seg" role="radiogroup" aria-label="Picture">
          {(
            [
              ["point", "Point at it"],
              ["window", "Whole window"],
              ["none", "No picture"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={m !== "none" && !shot}
              onClick={() => {
                setMode(m);
                if (m === "point") setPicking(true);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {!phone && mode === "point" ? (
        <p className="fb-hint">
          {picked ? (
            <>
              Pointed at <b>{picked.name}</b>.{" "}
              <button type="button" className="fb-link" onClick={() => setPicking(true)}>
                Point again
              </button>
            </>
          ) : (
            "Click the thing that's wrong. It gets a red outline and goes with your words."
          )}
        </p>
      ) : null}
      {pictureUrl ? (
        <div className="fb-shot-row">
          <img className="fb-shot" src={pictureUrl} alt="The picture that goes with it" />
          <div className="fb-shot-note">
            <span>
              {mode === "point" ? "Around what you pointed at" : "The screen you were on"}
            </span>
            {mode === "window" ? (
              <button type="button" className="fb-link" onClick={() => setDrawing(true)}>
                Draw on it
              </button>
            ) : null}
            <button type="button" className="fb-link" onClick={() => setMode("none")}>
              Leave it out
            </button>
          </div>
        </div>
      ) : null}
      <textarea
        id="fb-text"
        className="fb-text"
        aria-label="What went wrong"
        placeholder="What went wrong?"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        rows={phone ? 3 : 5}
      />
      <VoiceNote voice={voice} onVoice={setVoice} />
      <div className="fb-chips" aria-label="What goes with it">
        {facts.map((f) => (
          <span key={f} className="fb-chip on">
            {f}
          </span>
        ))}
        {lastError ? (
          <button
            type="button"
            className={`fb-chip${withErrors ? " on" : " off"}`}
            aria-pressed={withErrors}
            onClick={() => setWithErrors(!withErrors)}
          >
            Last errors
          </button>
        ) : null}
        <button
          type="button"
          className={`fb-chip${replies ? " on" : " off"}`}
          aria-pressed={replies}
          onClick={() => setReplies(!replies)}
        >
          Pavlo can reply
        </button>
      </div>
      {err ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {err}
        </p>
      ) : null}
      <div className="fb-send">
        <span className="fb-hint">Goes to Pavlo</span>
        <Button variant="primary" onClick={send}>
          Send
        </Button>
      </div>
    </>
  );

  return (
    <>
      {phone ? (
        <div className="fb-scrim" data-feedback-skip onClick={onClose}>
          <section
            className="fb-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fb-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fb-grab" aria-hidden />
            <h2 id="fb-title" className="fb-title">
              What went wrong?
            </h2>
            {body}
          </section>
        </div>
      ) : (
        <aside className="fb-pane" data-feedback-skip role="dialog" aria-labelledby="fb-title">
          <h2 id="fb-title" className="fb-title">
            Send feedback
            <button type="button" className="fb-close" aria-label="Close" onClick={onClose}>
              <X size={18} aria-hidden />
            </button>
          </h2>
          {body}
        </aside>
      )}
      {picking && shot ? (
        <PointAtIt
          onPick={async (el) => {
            setPicking(false);
            const rect = el.getBoundingClientRect();
            setPicked({ name: describeElement(el), crop: await cropAround(shot, rect) });
          }}
          onCancel={() => setPicking(false)}
        />
      ) : null}
      {drawing && picture ? (
        <DrawOn
          picture={picture}
          onDone={(b) => {
            setDrawing(false);
            if (b) setPicture(b);
          }}
        />
      ) : null}
    </>
  );
}

function useObjectUrl(blob: Blob | null): string | null {
  // Each run of the effect makes its own URL and revokes it on cleanup, so React's double run in
  // development never leaves a revoked URL on screen.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = blob ? URL.createObjectURL(blob) : null;
    void Promise.resolve().then(() => setUrl(made));
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [blob]);
  return url;
}

function Replies({ replies }: { replies: Reply[] }) {
  return (
    <div className="fb-replies" role="log" aria-label="Pavlo's replies">
      {replies.slice(-3).map((r) => (
        <p key={`${r.report}-${r.at}`} className="fb-reply">
          <b>Pavlo:</b> {r.text}
        </p>
      ))}
    </div>
  );
}

/** Tap the mic to talk, tap again to stop; a minute at most. */
function VoiceNote({ voice, onVoice }: { voice: Blob | null; onVoice: (b: Blob | null) => void }) {
  const rec = useRef<Recorder | null>(null);
  const [on, setOn] = useState(false);
  const [bars, setBars] = useState<number[]>([]);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [why, setWhy] = useState<string | null>(null);
  const url = useObjectUrl(voice);

  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      const l = rec.current?.level() ?? 0;
      setBars((b) => [...b.slice(-23), 4 + l * 20]);
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  useEffect(() => () => rec.current?.cancel(), []);

  if (!canRecord()) return null;
  const stop = async () => {
    const r = rec.current;
    rec.current = null;
    setOn(false);
    if (r) onVoice(await r.stop());
  };
  const start = async () => {
    setWhy(null);
    try {
      rec.current = await record(() => void stop());
      setStarted(Date.now());
      setNow(Date.now());
      setBars([]);
      setOn(true);
    } catch {
      setWhy("The microphone isn't allowed. You can type instead.");
    }
  };
  const secs = Math.floor((now - started) / 1000);
  return (
    <div className="fb-rec">
      <button
        type="button"
        className={`fb-mic${on ? " on" : ""}`}
        aria-label={on ? "Stop recording" : voice ? "Record again" : "Record a voice note"}
        onClick={() => void (on ? stop() : start())}
      >
        {on ? <Square size={16} aria-hidden /> : <Mic size={18} aria-hidden />}
      </button>
      {on ? (
        <>
          <span className="fb-wave" aria-hidden>
            {bars.map((h, i) => (
              <i key={i} style={{ height: `${h}px` }} />
            ))}
          </span>
          <span className="fb-hint">
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </span>
        </>
      ) : voice && url ? (
        <>
          <audio className="fb-audio" src={url} controls />
          <button type="button" className="fb-link" onClick={() => onVoice(null)}>
            Remove
          </button>
        </>
      ) : (
        <span className="fb-hint">{why ?? "or say it"}</span>
      )}
    </div>
  );
}

/** "Point at it": the thing under the pointer gets an outline; a click picks it. */
function PointAtIt({ onPick, onCancel }: { onPick: (el: Element) => void; onCancel: () => void }) {
  const [box, setBox] = useState<DOMRect | null>(null);
  const under = (x: number, y: number) =>
    document
      .elementsFromPoint(x, y)
      .find(
        (el) =>
          !el.closest("[data-feedback-skip]") &&
          !el.classList.contains("fb-point") &&
          el !== document.body &&
          el !== document.documentElement,
      ) ?? null;
  return (
    <div
      className="fb-point"
      data-feedback-skip
      onMouseMove={(e) => setBox(under(e.clientX, e.clientY)?.getBoundingClientRect() ?? null)}
      onClick={(e) => {
        const el = under(e.clientX, e.clientY);
        if (el) onPick(el);
        else onCancel();
      }}
    >
      {box ? (
        <span
          className="fb-point-box"
          style={{
            left: box.left - 4,
            top: box.top - 4,
            width: box.width + 8,
            height: box.height + 8,
          }}
        />
      ) : null}
      <span className="fb-point-tip">Click the thing that's wrong · Esc to stop</span>
    </div>
  );
}

/** Draw on the screenshot with a finger or the mouse: red lines, Done or Cancel. */
function DrawOn({ picture, onDone }: { picture: Blob; onDone: (b: Blob | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    void createImageBitmap(picture).then((img) => {
      const c = canvas.current;
      if (!c) return;
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")?.drawImage(img, 0, 0);
    });
  }, [picture]);
  const at = (e: React.PointerEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };
  return (
    <div className="fb-draw" data-feedback-skip role="dialog" aria-label="Draw on the picture">
      <canvas
        ref={canvas}
        className="fb-draw-canvas"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          last.current = at(e);
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const g = canvas.current!.getContext("2d")!;
          const p = at(e);
          g.strokeStyle = "#b5432e";
          g.lineWidth = Math.max(4, canvas.current!.width / 160);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(last.current.x, last.current.y);
          g.lineTo(p.x, p.y);
          g.stroke();
          last.current = p;
        }}
        onPointerUp={() => (last.current = null)}
      />
      <div className="fb-draw-bar">
        <Button onClick={() => onDone(null)}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => canvas.current?.toBlob((b) => onDone(b), "image/jpeg", 0.85)}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/** The sidebar's "Send feedback" on a computer, with its key. */
export function FeedbackNavItem() {
  const { open, on } = useFeedback();
  if (!on || currentDevice().kind === "android") return null;
  return (
    <button
      type="button"
      className="nav-link nav-link--secondary fb-nav"
      onClick={() => open()}
      title="Send feedback (Ctrl+Shift+F)"
    >
      <MessageSquareWarning size={18} />
      <span className="nav-label">Send feedback</span>
    </button>
  );
}

/** "Tell Pavlo" under an error message: the sheet opens with the error in it. */
export function TellPavlo({ error }: { error: string }) {
  const { open, on } = useFeedback();
  if (!on) return null;
  return (
    <Button size="sm" variant="ghost" onClick={() => open({ error })}>
      Tell Pavlo
    </Button>
  );
}

/** Settings → Data: Send feedback, and Pavlo's replies so far. */
export function FeedbackSettings() {
  const { open, on } = useFeedback();
  if (!on) return null;
  const replies = savedReplies();
  return (
    <section className="stack" aria-labelledby="feedback-h" style={{ gap: 8 }}>
      <h3 className="settings-h3" id="feedback-h">
        Feedback
      </h3>
      {replies.length ? <Replies replies={replies} /> : null}
      <div className="row">
        <Button onClick={() => open()}>Send feedback</Button>
      </div>
    </section>
  );
}
