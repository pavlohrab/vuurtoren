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
import type { KenningRepository } from "@app/db";
import { NlpClient, NlpError } from "@app/nlp-client";
import { watchClient } from "./degraded.js";
import type { Platform } from "./platform.js";
import type { AnkiStatus, AppServices, Settings } from "./types.js";

const ANKI_KEY_STORAGE = "kenning.ankiKey";

export const DEFAULT_SETTINGS: Settings = {
  // Dev server proxies /anki and /nlp (vite.config.ts); nginx proxies /nlp in production.
  ankiUrl: import.meta.env.DEV ? "/anki" : "http://127.0.0.1:8765",
  nlpUrl: (import.meta.env["VITE_NLP_URL"] as string | undefined) ?? "/nlp",
  lang: "nl",
  targetDeck: "Kenning::Nederlands",
  theme: "system",
  help: 0.25,
  newWords: "auto",
  glossClozes: false,
  grammarMarks: true,
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
  repo: KenningRepository;
  platform: Platform;
  /** Called when a change makes cached learner data stale (new-word budget, language). */
  changed: () => void;
}

export function createLiveSettings({ repo, platform, changed }: LiveSettingsDeps) {
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

  // Every language-server call feeds the shared degraded signal (review A17).
  const nlp = async () =>
    watchClient(
      new NlpClient({ url: (await settings()).nlpUrl, fetch: platform.fetch }),
      "nlp",
      nlpOutage,
    );

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

  const services: Pick<AppServices, "getSettings" | "saveSettings" | "ankiStatus" | "connectAnki"> =
    {
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
