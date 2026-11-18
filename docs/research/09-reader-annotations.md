# 09 — Subtle annotation in the reader (2026-11-18)

How reading and language apps mark things inside running text, and what Kenning takes from them for grammar marks, word states and reading comforts. Short desk research (web, 2026-11-18); the summaries are in our own words.

## What others do

- **LingQ** colours every word by status: a blue fill for words never seen, yellow for words being learnt, fading as the status rises, and a dotted underline for "known-ish" levels. The page can end up mostly coloured; users ask for more colours (grammar), not fewer, and add-ons to restyle it. Status colour is the whole interface. (LingQ forum threads, 2019–2024.)
- **Readlang** deliberately does not keep a colour per word: its author wanted the page distraction-free and highlights only what you looked up. (Readlang forum, "A color scale feature…", 2023.)
- **Language Reactor** codes words in subtitles by frequency or saved status; part-of-speech colouring is a user request, not a feature. Competitors (Lingopie, Immersive Reader) colour every word by part of speech. (Forum + third-party reviews, 2024–2026.)
- **Kindle / Apple Books**: highlights are user-made and rare; reading settings are a compact "Aa" panel with size steps (A− / A+), line spacing, margins, a few fonts (incl. a dyslexia-friendly one) and white / sepia / black page colours, remembered per device. (Amazon help, Apple support summaries, 2024–2026.)
- **Readwise Reader**: notes live in the right margin like print marginalia (inspired by Tufte sidenotes and comment threads), shown only when there is room; warm, low-saturation highlight colours. (Readwise blog/docs, 2022–2026.)
- **iA Writer**: _Syntax Highlight_ colours one part of speech at a time on demand (e.g. only adverbs, to find clutter); _Focus Mode_ dims everything but the current sentence or paragraph. Both are display-only modes, off by default. (ia.net support, 2025.)
- **Underline styles** (MDN, Chrome "custom text decorations" guide, 2025): solid for links, dotted for terms/abbreviations, wavy for errors; dotted and wavy need ~0.15–0.25em extra offset to clear descenders; size the offset in em.
- **Accessibility** (WCAG 2.2 SC 1.4.1, W3C failure F73): colour must not be the only cue; an underline or another non-colour difference is required, and hover-only cues do not count. Non-text marks need ≥ 3:1 against the background (SC 1.4.11).

## Principles for Kenning

1. **Clean text by default.** The page is not a heat map. The default shows word states only where they matter (to learn, learning) and no grammar colour at all.
2. **Point, don't paint.** Grammar starts as a margin mark — a 2px hairline beside the sentence, like a change bar — not as colour on the words. At most one mark per two sentences, never two neighbours; only topics worth noticing for this learner (at their level or one above, the course unit's topics, topics they focused on recently). Very common constructions (V2, de/het, plurals, perfect…) are never margin-marked.
3. **On demand, one thing at a time.** Like iA Writer's syntax highlight: tapping a mark underlines that sentence only; the focus picker marks one topic through the text, with a count and ‹ › to step through it. Esc steps back.
4. **Different jobs, different lines.** Word states keep their lines at the baseline (amber solid line, sage dotted line, apricot underline); grammar uses a row of fine dots further below the text in one muted slate token. Position and pattern differ, so the two read apart even in grayscale (SC 1.4.1), and both can sit on the same word.
5. **Quiet contrast, not low contrast.** All marks are ≥ 3:1 against every reading background (checked below); text is ≥ 4.5:1. Muted means desaturated, not faint.
6. **Comforts are per device and one tap away.** A compact "Aa" popover (5 sizes, spacing, width, font, theme) as in e-readers; Ctrl/Cmd + / − while reading; stored in localStorage (guarded, defaults if blocked).
7. **Focus mode = less chrome, not more effects.** Hide sidebar and toolbars, dim other paragraphs with an opacity transition (none under reduced motion); F to enter, Esc to leave.

## Decisions taken

| Thing                | Treatment                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Margin mark          | 2px × ~1em hairline, `--state-grammar-line` at 50%, 28px left of the column (22px on phones), 20px-wide button target; full colour on hover/focus/open            |
| Mark popover         | under the line of the last marked word, from the column's left edge: topic + level, this sentence's note, the topic summary, "Focus on this", "Open the topic"    |
| Grammar in text      | dotted row (1.7px dots every 4px) 0.26em below the text, `--state-grammar-line` 80%; the hit jumped to with ‹ › gets slightly larger, full-colour dots            |
| Focus picker         | "Grammar: <topic> ▾", search, Suggested (top 4 by priority), In this text (with counts); "n on this page" + ‹ › + ×; replaces the old all-topics spotlight toggle |
| Setting              | `grammarSpotlights` (off) → `grammarMarks` (on); users who had spotlights on keep grammar marks                                                                   |
| Learner level        | rough CEFR from the vocabulary estimate (< 600 A1, < 1500 A2, < 3000 B1, < 6000 B2, else C1; unknown → A2)                                                        |
| Text size            | 16 · 17.5 · 19.5 (default) · 22 · 25 px                                                                                                                           |
| Line spacing / width | 1.5 / 1.7 / 1.95; 36 / 44 / 52 rem                                                                                                                                |
| Fonts                | Literata (default), Inter, Atkinson Hyperlegible Next (self-hosted via Fontsource; Latin + Latin-ext only, Cyrillic falls back to Inter glyph by glyph)           |
| Reading themes       | match app / paper / sepia / night, as token sets set inline on the reader page (which fills the content area); sidebar, top bar and inspector keep the app theme  |

### Contrast of the reading themes (WCAG 2.1, tokens in `packages/ui/src/readingThemes.ts`, checked by `readingThemes.test.ts`)

| Theme     | ink  | muted | accent | to-learn text | ink on to-learn tint | to-learn line | known line | grammar line |
| --------- | ---- | ----- | ------ | ------------- | -------------------- | ------------- | ---------- | ------------ |
| paper     | 15.2 | 6.2   | 6.0    | 6.2           | 12.7                 | 4.1           | 4.8        | 4.8          |
| sepia     | 10.7 | 5.7   | 5.8    | 6.1           | 8.9                  | 4.2           | 4.8        | 4.8          |
| night     | 10.7 | 5.2   | 7.2    | 7.7           | 8.7                  | 6.9           | 7.5        | 7.1          |
| app light | 11.7 | 4.6   | 4.6    | 5.1           | 11.1                 | 3.5           | 4.0        | 4.1          |
| app dark  | 11.9 | 5.6   | 7.3    | 7.9           | 9.5                  | 7.1           | 7.8        | 7.2          |

## Sources

- LingQ forum, "What about having extra colors for grammar highlighting?" and status-colour threads — https://forum.lingq.com/t/what-about-having-extra-colors-for-grammar-highlighting/2347129 (2023), https://forum.lingq.com/t/why-are-some-words-underlined/73258 (accessed 2026-11-18)
- Readlang forum, "A color scale feature for tracking word familiarity progress" — https://forum.readlang.com/t/a-color-scale-feature-for-tracking-word-familiarity-progress/1634 (2023)
- Language Reactor forum, "Part of Speech – add identifier in subtitles export" — https://forum.languagelearningwithnetflix.com/t/part-of-speech-add-identifier-in-subtitles-export/12265 (accessed 2026-11-18)
- Amazon, "Accessible reading options for Kindle reading apps" — https://www.amazon.com/gp/help/customer/display.html?nodeId=TABlJ4ot69emTO8jJG (accessed 2026-11-18)
- AppleInsider, "Inside Apple Books" — https://appleinsider.com/inside/ios-18/tips/inside-apple-books----the-best-app-for-book-lovers (2024)
- Readwise, "The Next Chapter of Reader: Public Beta" — https://blog.readwise.io/the-next-chapter-of-reader-public-beta/ (2022); Reader docs, "Highlights, tags and notes" — https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes (accessed 2026-11-18)
- iA Writer support, "Syntax Highlight" and "Settings" — https://ia.net/writer/support/editor/syntax-highlight, https://ia.net/writer/support/basics/settings (2025)
- Chrome for Developers, "Custom text decorations" — https://developer.chrome.com/docs/modern-web-guidance/guides/visual-design/custom-text-decorations (2025); MDN, `text-decoration-style` (accessed 2026-11-18)
- W3C, WCAG 2.2 SC 1.4.1 Use of Color and failure F73 — https://www.w3.org/WAI/WCAG20/Techniques/failures/F73 ; Adrian Roselli, "On Link Underlines" (2016)
