# 01 — Market & competitors (Nov 2026)

> Prices come mostly from third-party pages dated Sep–Nov 2026 and are approximate. "Unverified" means not confirmed.

## Commercial reading / immersion tools

- **LingQ.** Imports text, tracks each word as blue/yellow/known, has the Lynx AI chat. Exports to Anki only; doesn't read Anki state. Closed source. Premium $14.99/mo or $119.99/yr; Premium Plus $29.99/mo. Web, iOS, Android. Weaknesses: expensive, its own SRS competes with Anki, weak translations for some languages. https://storylearning.com/lingq-review
- **Migaku.** Extension plus apps for Netflix, YouTube, ebooks and web. Imports Anki known words once (interval ≥ 21 days) through a legacy add-on or paste; no live sync, and users report broken imports. The third-party SynapseSync exists to fill that gap. No speaking features yet. $10/mo, $96/yr or $499 lifetime. https://migaku.com/faq/goals
- **Readlang.** Web reader and extension, Anki export, AI explanations. About $6/mo; Premium Plus about $15/mo. No mobile app.
- **Language Reactor.** Netflix/YouTube subtitles, Anki export (Pro). Free, Pro about $5/mo. Chrome only.
- **Kimchi Reader** (Korean only). Imports known words from Anki or LingQ and syncs cards to Anki through an add-on. About $4–5/mo. https://kimchi-reader.app/feature
- **Others:** Lingua Verbum, Toucan (Babbel; word swaps on web pages), Lingopie, Satori Reader, Dreaming Spanish, Lingo Champion, Jolii. None connect to an Anki collection.

## Free / open source

- **Lute v3** (MIT, ~1.6k★). Self-hosted reader with term status. Exports one way through AnkiConnect, never reads Anki back. No AI, OCR, mobile app or exercises. https://github.com/LuteOrg/lute-v3
- **Yomitan + asbplayer.** The standard mining stack. asbplayer can mark subtitles known/unknown from your Anki fields, but only for video. https://docs.asbplayer.dev/docs/guides/annotation
- **AnkiMorphs.** Anki add-on: marks words known by interval and sorts new cards i+1. No reading or AI. https://mortii.github.io/anki-morphs
- **Jiten.moe** (Japanese). Imports Anki known words via AnkiConnect, keeping maturity, and computes how much of each book or show you'd understand. https://jiten.moe/guides/importing-known-words-from-anki
- **Anki + AI add-ons:** AnkiBrain, Anki-GPT, anki-llm, Ghostwriter. They generate or explain cards only.

## Closest open-source projects (all small, 2025–26)

- **Lector** (AGPL, ~55★): reading from EPUB/URL/YouTube, Tatoeba clozes, two-way Anki add-on (beta), AI tutor (Claude/OpenAI-compatible/Ollama). No OCR, mobile app or extension. **Closest overall.** https://github.com/heuwels/lector
- **AnkiBase** (MIT): self-hosted Anki client for web, mobile and desktop; AI stories from learning cards (BYOK). Doesn't import your texts. https://github.com/Stefterv/AnkiBase
- **Jiku** (GPL): marks text known/unknown via AnkiConnect. https://github.com/TnTora/Jiku
- **Shiori**: Japanese desktop reader with .apkg support and an AI chat. https://github.com/PeterDessev/Shiori
- **anki-lesson**: generates texts with ≥ 80% known words and ≤ 2 new ones from AnkiConnect. https://github.com/palyla/anki-lesson
- **language-reader / Lang Lens**, **zh-immerse**: AI graded stories, BYOK, TSV export.

## AI conversation apps

Speak, Praktika, Talkpal, Langua, Duolingo Max ($8–30/mo). None connect to Anki, none are open source, none take your own key.

## Comparison

| Product           | Anki link               | OSS  | Self-host | AI (BYOK?)        | Price         | Platforms         |
| ----------------- | ----------------------- | ---- | --------- | ----------------- | ------------- | ----------------- |
| LingQ             | Export                  | No   | No        | Lynx (no)         | $15–30/mo     | Web/iOS/Android   |
| Migaku            | One-off import + export | No   | No        | Sentence gen (no) | $10/mo        | Web/mobile/Chrome |
| Readlang          | Export                  | No   | No        | Explanations      | $6–15/mo      | Web/ext           |
| Kimchi Reader     | Import + add-on sync    | No   | No        | ?                 | ~$5/mo        | Web/ext (KO)      |
| Lute v3           | AnkiConnect export      | MIT  | Yes       | None              | Free          | Desktop/web       |
| Yomitan+asbplayer | Two-way, known status   | Yes  | Local     | None              | Free          | Browser           |
| AnkiMorphs        | Inside Anki             | Yes  | n/a       | None              | Free          | Anki desktop      |
| Lector            | Two-way add-on (beta)   | AGPL | Yes       | Tutor (BYOK)      | Free/$5 cloud | Web/Docker        |
| AnkiBase          | Is an Anki client       | MIT  | Yes       | Stories (BYOK)    | Free          | All               |
| Speak/Praktika/…  | None                    | No   | No        | Core (no)         | $8–20/mo      | Mobile            |

## Gap analysis

No product combines everything. Each piece already exists somewhere:

- **Anki as the live record of known words:** asbplayer, Jiku, Jiten, AnkiMorphs.
- **Graded reading of your own texts:** LingQ, Migaku, Lute and Lector, but only colour-coding. **Nobody clozes learning words and caps new words per imported text.**
- **OCR of photos/PDFs in open source:** essentially nobody.
- **Rule-based exercises from your own cards:** nobody.
- **AI conversation constrained to known words:** nobody confirmed.
- **Weave reading** (translate a text above your level, keep known and near-level words in the target language): Toucan does the reverse on web pages, but nobody ties it to Anki.

## Positioning

> **"Your Anki deck, turned into a reading and speaking coach."**

- The app has no vocabulary store of its own; Anki maturity is the source of truth.
- Differentiators:
  1. A tunable i+1 dial on your own texts, from full weave to pure target language.
  2. Exercises from your own cards, offline, no AI.
  3. AI chat checked against your known words, with new words pushed to Anki.
- **Target users:** Anki power users (Refold, sentence mining, AnkiMorphs), privacy-minded self-hosters, academics.
- **First languages:** European languages (Dutch first), then Ukrainian.

## Risks

- **Matching words to cards** in inflected and CJK languages.
- **Anki access on mobile.**
- **Incumbents** (Migaku could add sync or AI chat quickly).
- **Fragmentation** (Lector and AnkiBase may close the gap first; consider interop).
- **Scope creep.**
- **LLMs drift** from the allowed vocabulary.
- **Copyright** on imported texts.
- **Burnout.** Lector's "free self-host, paid cloud" model is a workable template.
