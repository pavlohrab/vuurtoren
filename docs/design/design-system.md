# Design system: "Night lamp"

Dark-first and focused, like reading under a lamp: a deep blue-grey room, warm off-white ink, one soft violet accent, and two state colours that carry meaning (teal-green = known, amber = to learn). The light theme is designed on its own terms (cool, slightly violet-tinted paper with a deeper violet), not an inversion. The theme follows the system by default; the top-bar toggle cycles system / light / dark.

## Principles

1. **Reading first.** The text is the hero; chrome recedes.
2. **Quiet by default.** Information appears on demand: hover, click, inspector.
3. **No gamification theatre.** No mascots, streak guilt, confetti or badges. Progress is shown with calm, honest charts.
4. **Keyboard-first and accessible.** WCAG AA contrast, visible focus, `prefers-reduced-motion` respected.
5. **One system everywhere.** Web, desktop and extension share the same tokens and components.

## Typography

All faces are self-hosted via Fontsource (no Google CDN, for privacy).

| Role               | Face                                     | Size / leading           | Scripts                     |
| ------------------ | ---------------------------------------- | ------------------------ | --------------------------- |
| Headings, wordmark | **Instrument Sans** (variable, 600)      | 20–40px / 1.15, −0.012em | Latin only → Inter fallback |
| UI                 | **Inter** (variable, `tnum` for numbers) | 14–15px / 1.45           | Latin + Cyrillic            |
| Reading text       | **Literata** (variable serif)            | 19–20px / 1.7, max 66ch  | Latin + Cyrillic            |
| Data / mono        | **JetBrains Mono**                       | 13px                     | Latin + Cyrillic            |

- `--font-display` is `"Instrument Sans Variable", "Inter Variable", system-ui`. Instrument Sans has no Cyrillic, so Ukrainian headings render glyph by glyph in Inter, which matches its proportions closely. Checked: the Fontsource package ships `latin` and `latin-ext` subsets only.
- Literata stays the reading face: Newsreader (considered in the proposal) has no Cyrillic, and Ukrainian is planned.
- Scale: 12 · 14 · 16 · 20 · 24 · 30 · 40. Headings never all caps except the tiny overline labels (`.k-overline`, 11px, +0.06em). Text titles (Library cards' book titles, Continue reading) use Literata, because they are Dutch text.

## Color tokens

CSS custom properties in `packages/ui/src/styles.css`, exposed to Tailwind v4 via `@theme`. **No literal colours in components**: everything goes through these tokens (the only literals left are the token definitions themselves).

| Token           | Light     | Dark      | Use                                          |
| --------------- | --------- | --------- | -------------------------------------------- |
| `--bg`          | `#f4f3f7` | `#14161c` | page, sidebar                                |
| `--surface`     | `#fcfcfe` | `#1b1e26` | cards, panels, dialogs                       |
| `--surface-2`   | `#ecebf2` | `#222631` | hover, wells, tracks                         |
| `--ink`         | `#1b1d24` | `#ebe8e1` | body text                                    |
| `--ink-muted`   | `#5d5f6b` | `#9b9aa3` | secondary text                               |
| `--line`        | `#dddbe6` | `#2c303b` | borders, dividers                            |
| `--line-strong` | `#c9c6d6` | `#3a3f4d` | emphasised borders                           |
| `--accent`      | `#6a4fd6` | `#c9a7ff` | primary actions, links, focus, the logo ring |
| `--accent-ink`  | `#fcfcfe` | `#16121f` | text on an accent fill                       |
| `--accent-soft` | `#ebe6fb` | `#2a2540` | active nav item, icon wells, accent chips    |
| `--known`       | `#13896a` | `#7dd3b0` | coverage bars and rings, known lines         |
| `--known-ink`   | `#0f7a5e` | `#7dd3b0` | "Known" text and chips                       |
| `--known-soft`  | `#e3f0eb` | `#1c2f2b` | Known chip fill                              |
| `--learn`       | `#b7791f` | `#f2c26b` | to-learn underline                           |
| `--learn-ink`   | `#8a5a10` | `#f2c26b` | "To learn" text and chips                    |
| `--learn-soft`  | `#f7ebcf` | `#3b3222` | to-learn tint in the reader, chip fill       |
| `--success`     | `#0f7a5e` | `#7dd3b0` | correct answers                              |
| `--danger`      | `#b42f3a` | `#ff8f8f` | wrong, destructive                           |
| `--scrim`       | ink 36%   | black 60% | dialog and sheet backdrops                   |

Contrast (WCAG 2.1, checked with a script): body ink 15.2:1 (light) / 14.8:1 (dark); muted text ≥ 5.3:1 on every surface; accent text 5.1–5.5:1 (light) / 8.3:1 (dark); text on accent buttons 5.5:1 / 9.0:1; Known chip text 4.5:1 on its tint (light) / 9.4:1 (dark); To-learn chip text 5.1:1 / 10.1:1; reader ink on the to-learn tint 13.8:1 / 10.3:1. Non-text lines (to-learn underline, known bars) are ≥ 3:1 against the page: `--learn` 3.3:1 and `--known` 4.0:1 in light, both > 9:1 in dark. That is why the light theme has separate `-ink` tokens: the line colours are too light for 14px text.

### Word-state semantics (the heart of the reader)

| State                          | Treatment                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| to learn (planner `introduce`) | `--learn-soft` tint + a 2px `--learn` line that draws in once when the page appears                                    |
| new (in Gloss / budget views)  | `--learn-soft` tint + 1px `--learn` underline                                                                          |
| learning                       | dotted underline in a muted `--known`; opacity = 1 − recall (fades as you master it)                                   |
| known                          | no decoration in text; teal-green in chips, bars and rings                                                             |
| ignored / proper noun          | no decoration, never highlighted                                                                                       |
| gloss                          | dotted `--accent` underline + small superscript mark                                                                   |
| cloze                          | hairline blank sized to the word; focused blank gets an accent line                                                    |
| grammar spotlight (toggle)     | 2px inset line `--state-grammar-line` (rose `#b0437f`, dark `#e7a3c8`) under the construction; combines with the above |

Never use bright highlighter blocks. Violet is never a word state: it means "you can act here".

## Shape, depth, motion

- Spacing on a 4px grid (4, 8, 12, 16, 20, 24, 32, 48).
- Radius: 8px controls, 14px cards and dialogs, 999px chips.
- 1px borders do the separation; shadows only on popovers, dialogs (`--shadow-pop`) and hovered cards (`--shadow-lift`).
- Icons: **Lucide**, 1.5px stroke, 16/18/20px.

### Motion budget

CSS only, `transform` and `opacity` (plus the SVG ring's dash offset), 150–300 ms, nothing loops (the busy spinner and loading skeleton are the only exceptions), and everything is off under `prefers-reduced-motion`. Tokens: `--dur-fast` 150ms, `--dur` 200ms, `--dur-slow` 300ms, `--dur-fill` 700ms (rings and bars filling once), `--ease-out`, `--ease-in-out`, `--ease-pop`.

| Moment                         | Motion                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Route change                   | cross-fade through the View Transitions API (`defaultViewTransition`; browsers without it just switch) |
| To-learn word in the reader    | the amber line draws in left to right, once, when the page appears                                     |
| Word state changes (inspector) | the state chip pops (scale .88 → 1), each state its own keyframe so a change restarts it               |
| Library card hover             | lifts 2px with a soft shadow (pointer devices only)                                                    |
| Progress rings and bars        | fill once on mount (Home ring, coverage bars, Continue reading bar)                                    |
| Dialogs, toasts, More sheet    | fade + 6px rise                                                                                        |

The reader stays calm: no decorative motion while reading, only the one-time to-learn line.

## Logo

The **coverage ring**: a lowercase k inside a ring that is three-quarters complete, the share of a text you already know. The ring starts at 12 o'clock and runs counter-clockwise, so the open quarter sits at the top right, where the k's arm points. The ring is `--accent`, the k is `--ink`.

- Component: `Logo` (mark + "kenning" wordmark in Instrument Sans 600, −0.02em) and `LogoMark` from `@app/ui`. `variant="mark"` for the mark alone. `coverage={0.62}` draws the ring to that value once on mount (with a faint accent track); without it the ring is the static 3/4 brand arc.
- `ProgressRing` uses the same language (12 o'clock, counter-clockwise, round caps) for data: the Home ring is `--known`.
- Geometry, drawn on fixed grids with round caps and joins:
  - 48 grid (≥ 33px): ring r 18.5, stroke 4.5; k stroke 4.5: stem 19,13 → 19,35; arm 19,29.5 → 29,19.5; leg from 23,25.5 on the arm → 29.75,35.
  - 24 grid (19–32px): ring r 9.5, stroke 2.75; k stroke 2.5.
  - 16 grid (favicons): full-bleed ring r 7, stroke 2; k stroke 2, stem on the pixel grid (x 5–7).
- Clear space: one ring stroke on every side. Minimum size 16px. Wordmark size is 0.74 × the mark, gap 0.34 × the mark.
- Don't: recolour the k, close the ring, rotate the gap, put the mark on the accent colour, or add effects.
- Files in `apps/web/public`: `favicon.svg` (16 grid, light/dark through `prefers-color-scheme` inside the SVG), `favicon-16.png` / `favicon-32.png` (the mark on the dark rounded lamp tile, so it reads on light and dark tab bars), `apple-touch-icon.png` (180, mark on the dark lamp tile), `icon-192.png` / `icon-512.png` (rounded tile), `icon-maskable-512.png`, `logo-mark.svg`, `manifest.webmanifest`.

## Components

Radix primitives via **shadcn/ui**, restyled with the tokens: Button (primary / secondary / ghost), Input, Select, Slider (density dial), Tabs, Dialog, Popover, Tooltip, Toast (quiet, bottom-left), Command (⌘K), Table, Chip, Progress meter, Sparkline.

Domain components:

- `Reader`
- `Token` (renders the word states)
- `WordInspector`
- `ClozeBlank`
- `DensityDial`
- `CoverageMeter`
- `ExerciseCard`
- `ChatMessage` (with coverage chip)
- `GrammarSpotlight`
- `WordsFromTextReview`

## Layout

```
┌──────────┬───────────────────────────────────────────┬──────────────────┐
│ (k) kenning│ Top bar: title · coverage · mode · ⌘K · ◐ │  Inspector panel │
│ Home     │                                           │  (reader only)   │
│ Library  │      page content / reading column        │                  │
│ Practice │                                           │                  │
│ Words    │                                           │                  │
│ Courses  │                                           │                  │
│ Grammar  │                                           │                  │
│ Talk     │                                           │                  │
│ ⚙ Settings│                                          │                  │
└──────────┴───────────────────────────────────────────┴──────────────────┘
```

- Navigation: Home · Library · Practice · Words · Courses · Grammar · Talk, Settings at the bottom of the rail. There is no "Read" item: Continue reading on Home and the Library cards open texts. Progress is reached from Home (and ⌘K), not the rail.
- The rail collapses to icons below 1200px; the inspector becomes a bottom sheet below 900px.
- Below 700px a bottom tab bar replaces the rail: Home, Library, Practice, Words, More. More opens a sheet with Courses, Grammar, Talk, Progress and Settings.

## Screens

- **Home** (`/`, first screen): Dutch greeting for the time of day (Goedemorgen / Goedemiddag / Goedenavond) and quick actions (Import, Create a story when an AI provider is set, Talk); Continue reading (last text, page, progress, coverage); Today (read one page ~N min · practise X due · Y new words waiting to go to Anki · current course unit), each step a link; Your words (ring = share of the library you know, known / learning / vocabulary, link to Progress). A brand-new learner sees two first steps (Connect Anki, Import a text) instead.
- **Sign-in**: a small landing: the mark, the wordmark, one sentence on what Kenning does, then the form.
- **Onboarding** (`/welcome`): connect AnkiConnect, choose decks and fields, language profile.
- **Library:** cards per text with coverage, new-word count and difficulty band.
- **Import:** paste, URL, PDF, photo; editable OCR preview.
- **Reader:** read / cloze / gloss modes; end-of-text "Words from this text" list.
- **Practice:** one exercise per screen; keys 1–4, Enter, Esc.
- **Talk** (`/talk`, formerly Converse; `/converse` redirects): chat with coverage chips, inline corrections and new-word chips.
- **Words:** filterable lemma table.
- **Grammar:** topics with "seen in your texts" examples.
- **Progress:** vocabulary estimate and practice numbers (from Home).
- **Settings:** Anki, AI providers, translation engine, sync, data export.

## Voice & copy

Plain, precise and kind. "You know 96% of this text." No exclamation marks or cheerleading.
