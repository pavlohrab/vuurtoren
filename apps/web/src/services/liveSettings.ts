/**
 * Settings and the clients built from them: the language server (NLP) and AnkiConnect.
 * Secrets (the AnkiConnect key) stay in device storage and never enter the event log.
 */
import {
  AnkiConnectClient,
  probeAnki,
  requestAnkiPermission,
  type AnkiConnectionState,
} from "@app/anki";
import type { VuurtorenRepository } from "@app/db";
import { NlpClient, NlpError } from "@app/nlp-client";
import { DEGRADED_MESSAGES, watchClient } from "./degraded.js";
import type { Platform } from "./platform.js";
import type { AnkiStatus, AppServices, Settings } from "./types.js";

const ANKI_KEY_STORAGE = "vuurtoren.ankiKey";

export const DEFAULT_SETTINGS: Settings = {
  // Dev server proxies /anki and /nlp (vite.config.ts); nginx proxies /nlp in production.
  ankiUrl: import.meta.env.DEV ? "/anki" : "http://127.0.0.1:8765",
  nlpUrl: (import.meta.env["VITE_NLP_URL"] as string | undefined) ?? "/nlp",
  lang: "nl",
  targetDeck: "Vuurtoren::Nederlands",
  theme: "system",
  help: 0.25,
  newWords: "auto",
  glossClozes: false,
  grammarMarks: true,
  reviewWeek: [1, 1, 1, 1, 1, 1, 1],
  newWordsPerDay: 10,
  reviewsPerDay: 200,
  voice: "female",
  autoplayWord: true,
  autoplaySentence: true,
  audioRate: 1,
};

/** The language server is down or unreachable (not: it refused one request). */
export const nlpOutage = (e: unknown): boolean =>
  e instanceof NlpError && (e.status === null || e.status === 502 || e.status === 504);

/** Map the client's connection state to what the Settings screen shows. */
function toAnkiStatus(c: AnkiConnectionState): AnkiStatus {
  switch (c.state) {
    case "connected":
      return { connected: true, state: "connected", version: c.version };
    case "needs-key":
      return {
        connected: false,
        state: "needs-key",
        version: c.version,
        error: "Anki allows this site but wants an API key. Enter it above.",
      };
    case "not-allowed":
      return {
        connected: false,
        state: "not-allowed",
        error: "Anki does not allow this site yet.",
      };
    case "busy":
      return {
        connected: false,
        state: "busy",
        error: "Anki did not answer in time. Is a dialog open in Anki?",
      };
    default:
      return {
        connected: false,
        state: "not-running",
        error: "Cannot reach Anki. Is Anki running with the AnkiConnect add-on installed?",
      };
  }
}

export interface LiveSettingsDeps {
  repo: VuurtorenRepository;
  platform: Platform;
  /** Called when a change makes cached learner data stale (new-word budget, language). */
  changed: () => void;
  /**
   * The language server of the Vuurtoren server this device syncs with, used while the address
   * is the default `/nlp` (a device without a language server of its own); null otherwise.
   */
  languageServer?: () =>
    | Promise<{ url: string; token: string; fetch?: typeof globalThis.fetch } | null>
    | { url: string; token: string; fetch?: typeof globalThis.fetch }
    | null;
  /**
   * A phone: no language server of its own, so without a server to sync with the default
   * `/nlp` is only the app's own page. Its calls then fail at once with a plain reason.
   */
  noOwnLanguageServer?: boolean;
  /** A recorded clip kept on this device (a phone's recordings pack), else null. */
  localClip?: ((voice: string, id: string) => Promise<Blob | null>) | undefined;
}

/** The top bar on a phone whose computer or server isn't reachable (reading still works). */
const PHONE_AWAY = "Your phone needs a computer or a server to read new texts.";

/** What a phone's language-server calls fail with before it is connected to a server. */
const NO_LANGUAGE_SERVER = "no language server on this phone";

/**
 * `fetch` that sends `token` as a bearer token to `base` and its paths only (the sync token
 * opens that server's language server).
 */
function withBearer(fetch: typeof globalThis.fetch, base: string, token: string) {
  const root = base.replace(/\/+$/, "");
  return ((input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (target !== root && !target.startsWith(`${root}/`)) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }) as typeof globalThis.fetch;
}

export function createLiveSettings({
  repo,
  platform,
  changed,
  languageServer,
  noOwnLanguageServer = false,
  localClip,
}: LiveSettingsDeps) {
  let cache: Settings | null = null;

  async function settings(): Promise<Settings> {
    if (!cache) {
      const saved = await repo.setting<Partial<Settings>>("settings");
      // Older versions stored the key in the event log; ignore it there.
      const rest: Partial<Settings> & { grammarSpotlights?: boolean } = { ...saved };
      delete rest.ankiKey;
      // The all-topics spotlight toggle became margin marks (on by default): whoever had the
      // spotlights on keeps grammar in the reader; the old default (off) is not a choice.
      if (rest.grammarMarks === undefined && rest.grammarSpotlights === true)
        rest.grammarMarks = true;
      delete rest.grammarSpotlights;
      cache = { ...DEFAULT_SETTINGS, ...rest };
      const key = platform.storage.getItem(ANKI_KEY_STORAGE);
      if (key) cache.ankiKey = key;
    }
    return cache;
  }

  const lang = async () => (await settings()).lang;

  // Every language-server call feeds the shared degraded signal.
  const nlp = async () => {
    const url = (await settings()).nlpUrl;
    const theirs = url === DEFAULT_SETTINGS.nlpUrl ? ((await languageServer?.()) ?? null) : null;
    const client = theirs
      ? new NlpClient({
          url: theirs.url,
          fetch: withBearer(theirs.fetch ?? platform.fetch, theirs.url, theirs.token),
        })
      : noOwnLanguageServer && url === DEFAULT_SETTINGS.nlpUrl
        ? new NlpClient({
            url,
            fetch: (() => Promise.reject(new Error(NO_LANGUAGE_SERVER))) as typeof fetch,
          })
        : new NlpClient({ url, fetch: platform.fetch });
    // A phone reads without its computer; what it can't do then is take new texts.
    return watchClient(
      client,
      "nlp",
      nlpOutage,
      noOwnLanguageServer ? PHONE_AWAY : DEGRADED_MESSAGES.nlp,
    );
  };

  const ankiOptions = async (timeoutMs?: number) => {
    const s = await settings();
    return {
      url: s.ankiUrl,
      fetch: platform.fetch,
      ...(s.ankiKey ? { apiKey: s.ankiKey } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  };
  const anki = async (timeoutMs?: number) => new AnkiConnectClient(await ankiOptions(timeoutMs));

  // Clips by voice and id: the same id is always the same sound. A missing one stays missing for
  // the session on a computer (the pack comes with the language server), but not on a phone: its
  // recordings arrive by download, maybe while the app is open, and a word asked for before then
  // would otherwise stay silent (or in the phone's own voice) until the app restarts.
  const clips = new Map<string, Promise<Blob | null>>();

  const services: Pick<
    AppServices,
    | "getSettings"
    | "saveSettings"
    | "ankiStatus"
    | "connectAnki"
    | "ocrAvailable"
    | "audioClip"
    | "ownVoice"
    | "listening"
  > = {
    getSettings: settings,

    async saveSettings(patch: Partial<Settings>): Promise<void> {
      const next = { ...(await settings()), ...patch };
      // Secrets never go into the append-only (later: synced) event log.
      if ("ankiKey" in patch) {
        try {
          if (patch.ankiKey) platform.storage.setItem(ANKI_KEY_STORAGE, patch.ankiKey);
          else platform.storage.removeItem(ANKI_KEY_STORAGE);
        } catch {
          // storage full or blocked: the key lasts for this session only
        }
      }
      const persisted: Partial<Settings> = { ...next };
      delete persisted.ankiKey;
      await repo.append({ type: "SettingChanged", key: "settings", value: persisted });
      cache = next;
      if ("newWords" in patch || "lang" in patch) changed();
    },

    async ankiStatus(): Promise<AnkiStatus> {
      return toAnkiStatus(await probeAnki(await ankiOptions()));
    },

    async connectAnki() {
      const outcome = await requestAnkiPermission(await ankiOptions());
      const status = toAnkiStatus(await probeAnki(await ankiOptions()));
      return { denied: outcome.outcome === "denied", status };
    },

    async audioClip(id: string): Promise<Blob | null> {
      const voice = (await settings()).voice ?? DEFAULT_SETTINGS.voice;
      const key = `${voice}/${id}`;
      let clip = clips.get(key);
      if (!clip) {
        // The recordings on this phone first, then the server's.
        clip = (async () =>
          (await localClip?.(voice, id).catch(() => null)) ?? (await nlp()).audioClip(voice, id))();
        clips.set(key, clip);
        // An unreachable server is not an answer: ask again next time.
        clip.catch(() => clips.delete(key));
        if (localClip)
          void clip.then(
            (blob) => blob ?? clips.delete(key),
            () => undefined,
          );
      }
      return clip.catch(() => null);
    },

    ownVoice: {
      async available() {
        try {
          return (await (await nlp()).health()).data?.["speech"] === true;
        } catch {
          return false;
        }
      },
      say: async (text, rate) => (await nlp()).speech(text, rate),
    },

    listening: {
      async available() {
        try {
          return (await (await nlp()).health()).data?.["listen"] === true;
        } catch {
          return false;
        }
      },
      hear: async (wav) => (await nlp()).listen(wav),
    },

    async ocrAvailable(): Promise<boolean> {
      try {
        return (await (await nlp()).health()).ocr === true;
      } catch {
        return false;
      }
    },
  };

  return {
    settings,
    lang,
    nlp,
    anki,
    /** Another device changed the settings: read them again. */
    invalidate: () => {
      cache = null;
    },
    services,
  };
}
