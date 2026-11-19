/**
 * Tool logic of the Kenning MCP tools, independent of the MCP transport so it can be tested
 * directly. Used by the stdio server (apps/mcp, data over /api/rpc) and the API's own
 * Streamable HTTP endpoint (/api/mcp, data straight from the server's repository).
 *
 * Outputs are kept small: an assistant reads every byte of a tool result.
 * Nothing here writes to Anki: words for Anki are only *suggested*; the learner
 * confirms them in the app with the normal AddToAnki.
 */
import { coverageReport } from "@app/ai";
import { curriculum, grammarTopic, type GrammarTopic } from "@app/content";
import {
  type AnalyzedToken,
  DEFAULT_PLANNER,
  estimateVocabulary,
  normalizeKey,
  planText,
  readingTexts,
  wordKey,
} from "@app/core";
import { contentHash, countWords, type KenningRepository } from "@app/db";

export type ToolRepo = Pick<
  KenningRepository,
  | "append"
  | "courseBlocks"
  | "courses"
  | "getText"
  | "getTexts"
  | "learnerModel"
  | "listTexts"
  | "staircase"
  | "suggestedWords"
  | "unitExercises"
  | "unitWords"
  | "words"
  | "wordsByKeys"
>;

export interface ToolDeps {
  /** The user's data: the server's repository, or the HTTP repository against /api/rpc. */
  repo: ToolRepo;
  /** Tokenise text with the NLP server; undefined when no NLP server is configured. */
  analyze?: ((text: string) => Promise<AnalyzedToken[]>) | undefined;
  /** Learning language (default "nl"). */
  lang?: string | undefined;
  /** Who is calling, recorded on saved texts and suggestions (default "claude-code"). */
  by?: string | undefined;
  /** New text ids (tests inject a fixed one). */
  newId?: () => string;
}

/** Longest text body returned by get_text (keeps a single tool result a sensible size). */
export const MAX_TEXT_CHARS = 20_000;
/** Longest text save_text accepts. */
const MAX_SAVE_CHARS = 50_000;
/** Most words one suggest_words_for_anki call queues. */
const MAX_SUGGESTIONS = 30;
const MAX_WORDS = 500;
/** Texts get_words_to_learn plans at most (newest first). */
const MAX_PLANNED_TEXTS = 25;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The sentence around token `i` (from the token offsets). */
function sentenceOf(tokens: readonly AnalyzedToken[], content: string, i: number): string {
  const sent = tokens[i]?.sent;
  let a = i;
  let b = i;
  while (a > 0 && tokens[a - 1]!.sent === sent) a--;
  while (b < tokens.length - 1 && tokens[b + 1]!.sent === sent) b++;
  return clip(content.slice(tokens[a]!.start, tokens[b]!.end).trim(), 240);
}

export function createToolHandlers(deps: ToolDeps) {
  const lang = deps.lang ?? "nl";
  const by = deps.by ?? "claude-code";
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { repo } = deps;

  function needAnalyze() {
    if (!deps.analyze) {
      throw new Error(
        "No language server is configured for Kenning's MCP endpoint (KENNING_NLP_URL), so text cannot be analysed.",
      );
    }
    return deps.analyze;
  }

  async function findCourse(courseId: string | undefined) {
    const courses = await repo.courses();
    if (courses.length === 0) throw new Error("The learner has no courses in Kenning.");
    if (!courseId) return courses[0]!;
    const q = courseId.toLowerCase();
    const c =
      courses.find((x) => x.id === courseId) ??
      courses.find((x) => x.title.toLowerCase().includes(q));
    if (!c) throw new Error(`No course "${courseId}". Use list_courses.`);
    return c;
  }

  const topicBrief = (t: GrammarTopic) => ({
    id: t.id,
    title: t.title,
    level: t.level,
    summary: t.summary,
  });

  return {
    /** Words the learner knows (or another state), optionally filtered by prefix. */
    async getKnownWords(args: {
      limit?: number | undefined;
      query?: string | undefined;
      state?: "known" | "learning" | "seen" | "unknown" | undefined;
    }) {
      const limit = Math.min(Math.max(1, args.limit ?? 100), MAX_WORDS);
      const words = await repo.words(lang, {
        state: args.state ?? "known",
        limit,
        ...(args.query ? { query: args.query } : {}),
      });
      return {
        count: words.length,
        words: words.map((w) => ({
          word: w.key,
          state: w.state,
          ...(w.gloss ? { gloss: w.gloss } : {}),
        })),
      };
    },

    /** Share of words in `text` the learner knows, plus the words they do not. */
    async checkCoverage(args: { text: string }) {
      if (!args.text.trim()) throw new Error("text is empty");
      const analyze = needAnalyze();
      const [tokens, model] = await Promise.all([analyze(args.text), repo.learnerModel(lang)]);
      const r = coverageReport(tokens, model);
      return {
        coverage: Math.round(r.coverage * 1000) / 1000,
        words: r.words,
        unknownWords: r.unknown,
      };
    },

    async listTexts() {
      const texts = await repo.listTexts();
      return texts.map((t) => ({
        id: t.id,
        title: t.title,
        words: t.wordCount,
        source: t.sourceKind,
      }));
    },

    async getText(args: { id: string }) {
      const t = await repo.getText(args.id);
      if (!t) throw new Error(`No text with id ${args.id}. Use list_texts.`);
      const truncated = t.content.length > MAX_TEXT_CHARS;
      return {
        id: t.id,
        title: t.title,
        truncated,
        content: truncated ? t.content.slice(0, MAX_TEXT_CHARS) : t.content,
      };
    },

    /**
     * The words the reader highlights to learn ("to learn", amber): per text, the planner's
     * `introduce` words for the learner's level. Texts not yet opened (not analysed) are skipped.
     */
    async getWordsToLearn(args: { textId?: string | undefined; limit?: number | undefined }) {
      const limit = Math.min(Math.max(1, args.limit ?? 40), 200);
      const ids = args.textId
        ? [args.textId]
        : (await repo.listTexts())
            .filter((t) => t.analyzed && t.lang === lang)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_PLANNED_TEXTS)
            .map((t) => t.id);
      const [texts, model, stair] = await Promise.all([
        repo.getTexts(ids),
        repo.learnerModel(lang),
        repo.staircase(lang),
      ]);
      if (args.textId && texts.length === 0) throw new Error(`No text with id ${args.textId}.`);
      const opts = {
        ...DEFAULT_PLANNER,
        ...(stair ?? {}),
        vocabEstimate: estimateVocabulary(model),
        clozes: false,
      };
      const found = new Map<string, { text: string; sentence: string; count: number }>();
      for (const t of texts) {
        if (!t.tokens) continue;
        for (const plan of planText(t.tokens, model, opts, t.content)) {
          for (const key of plan.introduce) {
            const hit = found.get(key);
            if (hit) {
              hit.count++;
              continue;
            }
            const i = plan.tokens.find((p) => p.key === key)?.i ?? plan.segment.tokenStart;
            found.set(key, {
              text: t.title,
              sentence: sentenceOf(t.tokens, t.content, i),
              count: 1,
            });
          }
        }
      }
      const keys = [...found.keys()].slice(0, limit);
      const infos = new Map((await repo.wordsByKeys(lang, keys)).map((w) => [w.key, w]));
      return {
        note:
          texts.some((t) => !t.tokens) || texts.length === 0
            ? "Only texts the learner has opened in Kenning (analysed) are included."
            : undefined,
        words: keys.map((key) => {
          const f = found.get(key)!;
          const gloss = infos.get(key)?.gloss;
          return { word: key, ...(gloss ? { gloss } : {}), text: f.text, sentence: f.sentence };
        }),
      };
    },

    async listCourses() {
      return (await repo.courses()).map((c) => ({
        id: c.id,
        title: c.title,
        ...(c.level ? { level: c.level } : {}),
        units: c.units.map((u) => ({ n: u.n, title: u.title, kind: u.kind })),
      }));
    },

    /** One unit: its words with the learner's state, grammar topics and reading texts. */
    async getUnit(args: {
      courseId?: string | undefined;
      unit: number | string;
      includeTexts?: boolean | undefined;
    }) {
      const course = await findCourse(args.courseId);
      const q = String(args.unit).toLowerCase().trim();
      const unit =
        course.units.find((u) => String(u.n) === q) ??
        course.units.find((u) => u.title.toLowerCase() === q) ??
        course.units.find((u) => u.title.toLowerCase().includes(q));
      if (!unit) throw new Error(`No unit "${args.unit}" in ${course.title}. Use list_courses.`);
      const [words, exercises, blocks, library] = await Promise.all([
        repo.unitWords(course.id, unit.n),
        repo.unitExercises(course.id, unit.n),
        repo.courseBlocks(course.id),
        repo.listTexts(),
      ]);
      const keys = words.map((w) => normalizeKey(w.lemma));
      const infos = new Map((await repo.wordsByKeys(course.lang, keys)).map((w) => [w.key, w]));
      const topicIds = [...new Set(exercises.flatMap((e) => (e.grammar ? [e.grammar] : [])))];
      const inUnit = (page: number) => page >= unit.pages[0] && page <= unit.pages[1];
      return {
        course: { id: course.id, title: course.title },
        unit: { n: unit.n, title: unit.title, kind: unit.kind },
        words: words.map((w, i) => ({
          word: w.article ? `${w.article} ${w.lemma}` : w.lemma,
          ...(w.gloss ? { gloss: w.gloss } : {}),
          state: infos.get(keys[i]!)?.state ?? "unknown",
        })),
        grammarTopics: topicIds.flatMap((id) => {
          const t = grammarTopic(id, course.lang);
          return t ? [topicBrief(t)] : [];
        }),
        grammarNotes: blocks
          .filter((b) => b.kind === "grammar" && b.label && inUnit(b.page))
          .map((b) => b.label!),
        texts: readingTexts(blocks, unit).map((t) => {
          const textId = library.find((x) => x.title === t.title)?.id;
          return {
            title: t.title,
            words: countWords(t.text),
            ...(textId ? { textId } : {}),
            ...(args.includeTexts ? { content: clip(t.text, 4000) } : {}),
          };
        }),
      };
    },

    /** A grammar topic page, or the list of topics when no id is given. */
    async getGrammarTopic(args: { id?: string | undefined; query?: string | undefined }) {
      if (args.id) {
        const t = grammarTopic(args.id, lang);
        if (!t) throw new Error(`No grammar topic "${args.id}". Call without an id for the list.`);
        return {
          ...topicBrief(t),
          ...(t.pattern.length ? { pattern: t.pattern } : {}),
          body: clip(t.body, 8000),
          related: t.related,
        };
      }
      const q = args.query?.toLowerCase().trim();
      const all = curriculum(lang).filter(
        (t) =>
          !q ||
          t.id.includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.summary.toLowerCase().includes(q),
      );
      return { count: all.length, topics: all.map(topicBrief) };
    },

    /** Save a text Claude wrote to the Library (source "ai", provenance `by`), analysed when possible. */
    async saveText(args: {
      title: string;
      content: string;
      topic?: string | undefined;
      targets?: string[] | undefined;
      grammarTopic?: string | undefined;
    }) {
      const title = args.title.trim();
      const content = args.content.trim();
      if (!title) throw new Error("title is empty");
      if (!content) throw new Error("content is empty");
      if (content.length > MAX_SAVE_CHARS) {
        throw new Error(`content is too long (max ${MAX_SAVE_CHARS} characters)`);
      }
      const textId = newId();
      await repo.append({
        type: "TextImported",
        textId,
        title: clip(title, 200),
        lang,
        content,
        source: {
          kind: "ai",
          provider: by,
          model: by,
          targets: (args.targets ?? []).slice(0, 50),
          topic: args.topic ?? "",
          ...(args.grammarTopic ? { grammarTopic: args.grammarTopic } : {}),
          ref: by,
        },
      });
      // Analyse now when a language server is available; otherwise the app does it on open.
      let coverage: number | undefined;
      if (deps.analyze) {
        try {
          const [tokens, model] = await Promise.all([
            deps.analyze(content),
            repo.learnerModel(lang),
          ]);
          await repo.append({
            type: "TextAnalyzed",
            textId,
            contentHash: contentHash(content),
            tokens,
          });
          coverage = Math.round(coverageReport(tokens, model).coverage * 1000) / 1000;
        } catch {
          // Analysis is optional here: the app analyses the text when it is opened.
        }
      }
      return {
        textId,
        title,
        words: countWords(content),
        ...(coverage === undefined ? {} : { coverage }),
        note: "Saved to the Kenning Library; the learner can open it in the reader now.",
      };
    },

    /**
     * Queue words for the learner to confirm in Kenning (Words hub, "Suggested by Claude").
     * Never writes to Anki. Words already in Anki or known are skipped.
     */
    async suggestWordsForAnki(args: {
      words: { word: string; gloss?: string | undefined; sentence?: string | undefined }[];
      note?: string | undefined;
    }) {
      if (args.words.length === 0) throw new Error("words is empty");
      if (args.words.length > MAX_SUGGESTIONS) {
        throw new Error(`At most ${MAX_SUGGESTIONS} words per call.`);
      }
      const items = args.words
        .map((w) => ({ ...w, word: w.word.trim(), key: wordKey(lang, w.word) }))
        .filter((w) => w.word && w.key);
      const [infos, open] = await Promise.all([
        repo.wordsByKeys(
          lang,
          items.map((w) => w.key),
        ),
        repo.suggestedWords(lang),
      ]);
      const byKey = new Map(infos.map((w) => [w.key, w]));
      const pending = new Set(open.map((s) => s.key));
      const queued: string[] = [];
      const skipped: { word: string; reason: string }[] = [];
      const seen = new Set<string>();
      for (const w of items) {
        const info = byKey.get(w.key);
        const reason = seen.has(w.key)
          ? "duplicate"
          : info && (info.noteIds.length > 0 || info.addedNoteId !== undefined)
            ? "already in Anki"
            : info?.state === "known"
              ? "already known"
              : pending.has(w.key)
                ? "already suggested"
                : null;
        seen.add(w.key);
        if (reason) {
          skipped.push({ word: w.word, reason });
          continue;
        }
        await repo.append({
          type: "WordSuggested",
          lang,
          key: w.key,
          word: clip(w.word, 80),
          by,
          ...(w.gloss?.trim() ? { gloss: clip(w.gloss.trim(), 200) } : {}),
          ...(w.sentence?.trim() ? { sentence: clip(w.sentence.trim(), 400) } : {}),
          ...(args.note?.trim() ? { note: clip(args.note.trim(), 200) } : {}),
        });
        queued.push(w.word);
      }
      return {
        queued,
        skipped,
        note: "Nothing was added to Anki. The learner reviews these under Words → Suggested by Claude and adds the ones they want.",
      };
    },
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
