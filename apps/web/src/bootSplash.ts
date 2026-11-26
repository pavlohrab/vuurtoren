/**
 * The start screen (index.html, #boot): the logo draws itself while the app starts. Once the
 * app is on screen and the drawing is done, the logo drifts into the sidebar's logo (wide
 * screens), or shrinks and fades where there is none (a phone, the welcome steps), and the
 * screen goes. With reduced motion it just fades.
 *
 * Only the first start plays the whole drawing. Every later start leaves as soon as the app is
 * ready (about 0.6 s), with a short fade: the drawing used to hold a ready app for 3.5–5.5 s
 * on every launch (A9).
 */

/** The drawing ends at about this time after the page starts (index.html's delays: the last
 * line ends at 3.1 s), plus a moment to look at it before it moves. */
const DRAWN_MS = 3500;

let done = false;

/** Remembered once the drawing has been seen in full. */
const SEEN_KEY = "vuurtoren-boot-seen";

function seenBefore(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // No storage: the drawing plays again next time, nothing worse.
  }
}

/**
 * A moment of silence, played muted while the logo draws: it starts the system's media player
 * (on Linux, GStreamer loads its plugins the first time), so the first real clip plays at once.
 */
function warmUpAudio(): void {
  try {
    // A WAV header and 16 bytes of silence (8 kHz, 8-bit, mono).
    const wav =
      "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAACAgICAgICAgICAgICAgICA";
    const audio = new Audio(wav);
    audio.muted = true;
    void audio.play().catch(() => undefined);
  } catch {
    // No media here: nothing to warm up.
  }
}

export function finishBoot(): void {
  if (done) return;
  done = true;
  warmUpAudio();
  const boot = document.getElementById("boot");
  if (!boot) return;
  // Automated browsers (the tests, the screenshots) get the app at once.
  if (navigator.webdriver) {
    boot.remove();
    return;
  }
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const first = !seenBefore();
  markSeen();
  if (!first) {
    quickLeave(boot, still);
    return;
  }
  // The drawing started with the first frame (public/boot.js), not with the page.
  const started = (window as Window & { __vuurtorenBootAt?: number }).__vuurtorenBootAt ?? 0;
  const wait = still ? 0 : Math.max(0, DRAWN_MS - (performance.now() - started));
  window.setTimeout(() => leave(boot, still), wait);
}

/** A later start: the app is ready, the start screen fades in a moment. */
function quickLeave(boot: HTMLElement, still: boolean): void {
  boot.style.pointerEvents = "none";
  if (still || typeof boot.animate !== "function") {
    boot.remove();
    return;
  }
  const fade = boot.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 250,
    easing: "ease",
    fill: "forwards",
  });
  void fade.finished.then(() => boot.remove());
}

function leave(boot: HTMLElement, still: boolean): void {
  // The app's own frame may need a moment to lay out its sidebar.
  window.requestAnimationFrame(() => {
    const logo = boot.querySelector<HTMLElement>(".logo");
    const target = document.querySelector<SVGElement>(".sidebar-brand svg");
    const box = target?.getBoundingClientRect();
    const canAnimate = typeof boot.animate === "function" && !still && logo;
    if (!canAnimate) {
      boot.remove();
      return;
    }
    const from = logo.getBoundingClientRect();
    const moves = !!box && box.width > 0 && box.height > 0;
    const end = moves
      ? `translate(${box.left + box.width / 2 - (from.left + from.width / 2)}px, ${
          box.top + box.height / 2 - (from.top + from.height / 2)
        }px) scale(${box.width / from.width})`
      : "scale(0.6)";
    if (moves && target) target.style.opacity = "0";
    logo.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: end, opacity: moves ? 1 : 0 },
      ],
      {
        duration: moves ? 1800 : 700,
        easing: "cubic-bezier(.65,0,.25,1)",
        fill: "forwards",
      },
    );
    // The background layer's opacity, not its colour: the graphics card does it, so the logo's
    // move stays smooth while the app renders under it.
    const bg = boot.querySelector<HTMLElement>(".boot-bg") ?? boot;
    const fade = bg.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 800,
      delay: moves ? 1200 : 200,
      easing: "ease",
      fill: "forwards",
    });
    // The app takes taps while the logo travels.
    boot.style.pointerEvents = "none";
    void fade.finished.then(() => {
      if (target) target.style.opacity = "";
      boot.remove();
    });
  });
}
