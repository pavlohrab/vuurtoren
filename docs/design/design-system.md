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
- Scale: 12 · 14 · 16 · 20 · 24 · 30 · 40. Headings never all caps except the tiny overline labels (`.k-overline`, 11px, +0.06em). Literata is **only** for Dutch reading text (the reader, excerpts, example sentences, chat bubbles) and text titles (covers, Continue reading). Single Dutch words in UI (chips, table lemmas, the inspector headword) are Inter 500, never serif. See _Type roles_ below.

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

- Spacing: the 8px scale in **Layout & composition** below.
- Radius: 8px controls, 12px covers, 14px surfaces and dialogs, 999px chips.
- Hairlines (`--hairline`, ink at ~8%) do the separation; `--line` is for control borders. Shadows only on popovers, dialogs (`--shadow-pop`) and hovered covers (`--shadow-lift`).
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

## Layout & composition (polish 3, 2026-11-18)

One set of rules for every screen, so the app reads as one product.

### Spacing

An 8px scale with one 4px half-step. Tokens on `:root`: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 24 · `--s-6` 32 · `--s-7` 48 · `--s-8` 64. Use only these.

| Between                              | Space                                        |
| ------------------------------------ | -------------------------------------------- |
| label and its control, icon and text | 4–8                                          |
| items in a list row, chips in a row  | 8                                            |
| a section header and its content     | 16                                           |
| page header and the first section    | 32                                           |
| sections on a page                   | 48 (32 phone)                                |
| page padding                         | 32 top, 24 sides, 64 bottom (24/16/96 phone) |

### Grid and content widths

A 12-column grid, 24px gutters (16px on phones). Every page sits in one centred `.page` column whose width depends on the page type, so the header lands on the same edge on every page of that type:

| Page type         | Width                   | Screens                                                                |
| ----------------- | ----------------------- | ---------------------------------------------------------------------- |
| Dashboard / shelf | `--w-wide` 1200px       | Home, Library, Progress, Courses                                       |
| List / form       | `--w-list` 960px        | Words, Practice, Grammar, Talk, Settings, Import, Words from this text |
| Reading           | `--w-read` 68ch (44rem) | Reader, Grammar topic prose column, onboarding, sign-in card           |

Inside a page, split the grid only as 12, 8 + 4, 7 + 5 or 6 + 6. No rows with different splits stacked on one another without a section header between them. Below 900px everything is one column.

### Surfaces

A surface (`--surface` fill, hairline edge, 14px radius) only **groups interactive objects**: a dialog, the inspector, a popover, a cover, a form card that saves as one. Everything else — stats, explanations, steps, lists, settings rows — lives on the page with whitespace, type and hairline dividers. Never nest a surface inside a surface. Filled tints (`--accent-soft`, `--learn-soft`) are for state (selected, word to learn), not decoration.

### Page header (`PageHeader`)

Every top-level screen, Home included: h1 (Instrument Sans 600, 28px, 24 on phones), one muted line on what the page is for (max 62ch), actions on the right (at most one primary, plus up to two secondary or ghost). No border under it. Home's h1 is the greeting. Sub-pages (Grammar topic, Words from this text) use the same header with a back link above the title.

### Section header (`SectionHeader`)

h2 in Instrument Sans 600, 17px, ink; optional quiet link on the right (`.k-link`: accent text + 14px arrow). No caps overlines as section heads; `.k-overline` is only for tiny labels inside a component (inspector rows, cover kind).

### Lists

`.k-list`: rows separated by hairlines, no outer box, min row height 48px (56 with a hint line), 12px vertical padding, the row is the link with a chevron or arrow at the end. Tables (Words) follow the same look: hairline rows, 12px caps-free muted header.

### Buttons and links

- **Primary** (filled accent): one per view — the thing most people came to do (Continue reading on Home, Import on Library, Start on Practice, Apply on Words from this text).
- **Secondary** (hairline outline): other actions in the header or a form.
- **Ghost**: tools in rows (icons), cancel in dialogs next to a primary.
- **Quiet link** (`.k-link`): navigation to another place ("All words →"). One style everywhere.
- Destructive actions use `danger` only inside a confirming dialog.

### Chips

One shape: 24px tall, pill, Inter 12.5px, hairline edge. Tones: neutral, accent, known (sage), learn (apricot). Word chips (`.k-word-chip`, clickable Dutch words) are 32px tall, Inter 14px 500, with the article muted. Toggle chips (`.k-toggle`, Practice options) show selection with an accent-soft fill, accent edge and a check — never a solid accent fill (that is the primary button).

### Type roles

| Role                      | Face / size                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Page title                | Instrument Sans 600, 28 / 24 phone                                                              |
| Section title             | Instrument Sans 600, 17                                                                         |
| Text title (covers, hero) | Literata 500, 15–32                                                                             |
| Reading text, excerpts    | Literata 400, 17–20                                                                             |
| UI, labels, chips, lemmas | Inter 400/500, 13–15                                                                            |
| Meta                      | Inter 13, `--ink-muted`                                                                         |
| Numbers                   | `.k-num`: Instrument Sans 600, tabular, 28 (stat) / 20 (inline stat); label below in 13px muted |

### Covers

`TextCover` is typographic: a flat tint by source kind (paste and AI: honey, web and photo: sage, PDF and course: apricot, talk: neutral) with a darker spine on the left, the source icon and kind at the top, the title in Literata at the bottom and the coverage as a thin sage line on the bottom edge (with the percentage when there is no meter next to it). Portrait 4:5 everywhere: Library shelf, Home hero and Recent texts. No generated patterns.

### Empty, loading, error

- Empty: `EmptyState` left-aligned inside the section it replaces (icon 20px, one sentence, one action). Full-page empty only when the whole page is empty.
- Loading: skeletons in the shape of the content; no "Loading…" text except in buttons.
- Error: `ErrorNotice` (hairline box with danger edge, what happened, what to try).

### Icons

Lucide, 1.5 stroke: 16 in buttons and rows, 14 in quiet links and chips, 20 in empty states, 18 in nav. No filled icon wells except the nav active state.

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

- **Home** (`/`, first screen): calm and editorial, not a dashboard; four groups above the fold. (1) The page header: Dutch greeting, "You know N Dutch words", Import and Create a story. (2) Continue reading without a box (cover, Literata title, two-line excerpt, progress, the one primary button) next to a quiet column behind a hairline: the known-words ring and three numbers. (3) Today: two or three steps as one list with hairline dividers (practise, words waiting for Anki, course unit; done steps get a check). (4) Words to learn now (Inter word chips) and Recent texts (covers). Below: one quiet "More for today" line (grammar topic in your texts, Talk about the text, this week). A brand-new learner sees two first steps (Connect Anki, Import a text) instead.
- **Sign-in**: a small landing: the mark, the wordmark, one sentence on what Kenning does, then the form.
- **Onboarding** (`/welcome`): connect AnkiConnect, choose decks and fields, language profile.
- **Library:** a shelf of typographic covers (4:5, tinted by source kind), each with words, new words, a whole-text coverage meter, "Continue · page N of M" as a quiet link for texts in progress, and ghost tools (words, delete). No boxes around the items.
- **Import:** paste, URL, PDF, photo; editable OCR preview.
- **Reader:** read / cloze / gloss modes; the end of a text shows a calm completion panel (new words met, in Anki, still to decide) leading to Words from this text, Practise these words, Talk about this text and Next text.
- **Practice:** one exercise per screen; keys 1–4, Enter, Esc.
- **Talk** (`/talk`, formerly Converse; `/converse` redirects): chat with coverage chips, inline corrections and new-word chips.
- **Words:** the hub. State / source / search filters live in the URL with removable chips; rows open the shared inspector; a selection goes to Anki, Practice or Talk.
- **Grammar:** topics with "seen in your texts" examples.
- **Progress:** vocabulary estimate and practice numbers (from Home).
- **Settings:** sections with a sub-nav (a list on phones): Account, Language & decks (Anki connection first), Reading, AI, Data & backup, Advanced. Changes save themselves with a quiet "Saved" note; the theme is only in the top bar.
- **Page header:** every top-level screen opens with the same header: title (h1), one line on what the page is for, the primary action on the right.

## Voice & copy

Plain, precise and kind. "You know 96% of this text." No exclamation marks or cheerleading.

## Palette update — "Lamp amber" (2026-11-18)

The violet Night lamp accent was replaced by a warmer, dimmer palette at the user's request:
honey-amber accent on warm charcoal (dark) and warm, slightly dimmed paper (light); known words in
sage green, words to learn in apricot (kept distinct from the amber accent). Text and accents are
deliberately softer than pure white/black. All text pairs stay at or above WCAG AA 4.5:1 (ink ≈ 11.8:1,
muted ≈ 4.6–5.6:1, accent links ≈ 4.6–7.3:1). Tokens live in `packages/ui/src/styles.css`; the logo and
favicons were regenerated in the same colours. The older violet values above are superseded.
