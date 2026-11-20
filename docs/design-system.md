# Design system: "Lamp amber"

Dark-first and focused, like reading under a lamp: warm charcoal, soft off-white ink, one honey-amber accent, and two state colours that carry meaning (sage green = known, apricot = to learn). The light theme is warm, slightly dimmed paper, designed on its own terms, not an inversion. Text and accents are deliberately softer than pure white or black. The theme follows the system by default; the top-bar toggle cycles system / light / dark.

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

- `--font-display` is `"Instrument Sans Variable", "Inter Variable", system-ui`.
- Scale: 12 · 14 · 16 · 20 · 24 · 30 · 40. Headings never all caps except the tiny overline labels (`.k-overline`, 11px, +0.06em). Literata is **only** for Dutch reading text (the reader, excerpts, example sentences, chat bubbles) and text titles (covers, Continue reading). Single Dutch words in UI (chips, table lemmas, the inspector headword) are Inter 500, never serif. See _Type roles_ below.

## Color tokens

CSS custom properties in `packages/ui/src/styles.css`, exposed to Tailwind v4 via `@theme`. **No literal colours in components**: everything goes through these tokens (the only literals left are the token definitions themselves).

| Token           | Light     | Dark      | Use                                       |
| --------------- | --------- | --------- | ----------------------------------------- |
| `--bg`          | `#ece5d9` | `#151210` | page, sidebar                             |
| `--surface`     | `#f3ede3` | `#1b1714` | cards, panels, dialogs                    |
| `--surface-2`   | `#e5ddcf` | `#221d19` | hover, wells, tracks                      |
| `--ink`         | `#2e2721` | `#d6cdbf` | body text                                 |
| `--ink-muted`   | `#6e6457` | `#958b7e` | secondary text                            |
| `--line`        | `#ddd3c3` | `#2b2520` | borders, dividers                         |
| `--line-strong` | `#cbbfac` | `#3a332c` | emphasised borders                        |
| `--accent`      | `#8f5a1f` | `#c99a5b` | primary actions, links, focus             |
| `--accent-ink`  | `#f6f0e6` | `#1a140e` | text on an accent fill                    |
| `--accent-soft` | `#efe2cc` | `#2f2519` | active nav item, icon wells, accent chips |
| `--known`       | `#4a7a52` | `#8fb18c` | coverage bars and rings, known lines      |
| `--known-ink`   | `#3d6a45` | `#8fb18c` | "Known" text and chips                    |
| `--known-soft`  | `#e2e8d9` | `#1f271e` | Known chip fill                           |
| `--learn`       | `#b5643f` | `#d4906f` | to-learn underline                        |
| `--learn-ink`   | `#97492a` | `#d99a7b` | "To learn" text and chips                 |
| `--learn-soft`  | `#f1dccd` | `#33231c` | to-learn tint in the reader, chip fill    |
| `--success`     | `#3d6a45` | `#8fb18c` | correct answers                           |
| `--danger`      | `#a83a31` | `#e0877a` | wrong, destructive                        |
| `--scrim`       | ink 36%   | black 60% | dialog and sheet backdrops                |

Contrast: every text pair is at least WCAG AA 4.5:1 (ink ≈ 11.8:1, muted ≈ 4.6–5.6:1, accent links ≈ 4.6–7.3:1). Non-text lines (to-learn underline, known bars) are at least 3:1 against the page. The `-ink` tokens exist because the line colours are too light for 14px text.

### Word-state semantics (the heart of the reader)

| State                          | Treatment                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| to learn (planner `introduce`) | `--learn-soft` tint + a 2px `--learn` line that draws in once when the page appears                                        |
| new (in Gloss / budget views)  | `--learn-soft` tint + 1px `--learn` underline (text decoration, 3px offset)                                                |
| learning                       | dotted underline in a muted `--known`; opacity = 1 − recall (fades as you master it)                                       |
| known                          | no decoration in text; teal-green in chips, bars and rings                                                                 |
| ignored / proper noun          | no decoration, never highlighted                                                                                           |
| gloss                          | dotted `--accent` underline + small superscript mark                                                                       |
| cloze                          | hairline blank sized to the word; focused blank gets an accent line                                                        |
| grammar (open mark / focus)    | a row of fine dots in `--state-grammar-line`, 0.26em below the text (under the word-state lines); see _Reader annotations_ |

Never use bright highlighter blocks. The accent is never a word state: it means "you can act here".

## Shape, depth, motion

- Spacing: the 8px scale in **Layout & composition** below.
- Radius: 8px controls, 12px covers, 14px surfaces and dialogs, 999px chips.
- Hairlines (`--hairline`, ink at ~8%) do the separation; `--line` is for control borders. Shadows only on popovers, dialogs (`--shadow-pop`) and hovered covers (`--shadow-lift`).
- Icons: **Lucide**, 1.5px stroke, 16/18/20px.

### Motion budget

CSS only, `transform` and `opacity` (plus the SVG ring's dash offset), 150–300 ms, nothing loops (the busy spinner, loading skeleton and a play button's pulse while its sound plays are the only exceptions), and everything is off under `prefers-reduced-motion`. Use the tokens, never raw values: `--dur-fast` 150ms, `--dur` 200ms, `--dur-slow` 300ms, `--dur-fill` 700ms (rings and bars filling once), `--ease-out`, `--ease-in-out`, `--ease-pop`.

| Moment                         | Motion                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Route change                   | cross-fade through the View Transitions API (`defaultViewTransition`; browsers without it just switch)                                    |
| To-learn word in the reader    | the amber line draws in left to right, once, when the page appears                                                                        |
| Word state changes (inspector) | the state chip pops (scale .88 → 1), each state its own keyframe so a change restarts it                                                  |
| Library card hover             | lifts 2px with a soft shadow (pointer devices only)                                                                                       |
| Progress rings and bars        | fill once on mount (Home ring, coverage bars, Continue reading bar)                                                                       |
| Dialogs, toasts, More sheet    | fade + 6px rise in; dialogs and the palette fade out (`--dur-fast`)                                                                       |
| Popovers, menus, tooltips      | scale-fade (.96 → 1) from the side they open on (`--dur-fast`)                                                                            |
| Inspector                      | slides in from the right over the content (`--dur-slow`, transform); the reading column moves aside by half its width; bottom sheet rises |
| Library covers, Words rows     | appear once in a short cascade (30 ms steps, at most 150 ms); rows fade only, so filters never jump                                       |
| Buttons, toggle chips          | 1px press on `:active`                                                                                                                    |
| Loading skeleton               | invisible for the first 150 ms (fast loads never flash), then a soft 1.2 s sweep while loading                                            |

The reader stays calm: no decorative motion while reading, only the one-time to-learn line.

## Logo

The **lighthouse**: a small tower whose beam is an `--accent` highlight bar, beside three lines of text in which one word is lit the same way. The reader does the same thing: it lights up the few words worth learning now.

- Component: `Logo` (mark + "vuurtoren" wordmark, Literata 500, as outlined paths) and `LogoMark` from `@app/ui`. `variant="mark"` for the mark alone. The tower and text lines use `currentColor` (`--ink`), the lantern, beam and lit word `--accent`; the plain text lines are `--ink` at 30% opacity.
- One 64 grid for every size (paths in `Logo.tsx`): lantern x 10–22, y 8–21; beam x 25–60, y 11.5–17.5; tower x 5.5–26.5, y 24–57 on a base at y 57–60.5; text lines at y 28, 37 and 46, the lit word x 44.5–60, y 36–41.5.
- Icons (favicon, PWA, desktop) put the mark on a `#f6f0e6` paper tile, which stays readable at 16px on light and dark tab bars.
- `ProgressRing` (12 o'clock, counter-clockwise, round caps) is for data, not branding: the Home ring is `--known`.

## Layout & composition

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

A 12-column grid, 24px gutters (16px on phones). Every page sits in one `.page` column whose width depends on the page type. All page types start on the left edge of the wide column, so headers line up across the app; only the right edge moves:

| Page type         | Width                   | Screens                                                                |
| ----------------- | ----------------------- | ---------------------------------------------------------------------- |
| Dashboard / shelf | `--w-wide` 1200px       | Home, Library, Progress, Courses                                       |
| List / form       | `--w-list` 960px        | Words, Practice, Grammar, Talk, Settings, Import, Words from this text |
| Reading           | `--w-read` 68ch (44rem) | Reader, Grammar topic prose column, onboarding, sign-in card           |

Inside a page, split the grid only as 12, 8 + 4, 7 + 5 or 6 + 6. No rows with different splits stacked on one another without a section header between them. Below 900px everything is one column.

### Surfaces

A surface (`--surface` fill, hairline edge, 14px radius) only **groups interactive objects**: a dialog, the inspector, a popover, a cover, a form card that saves as one. Everything else — stats, explanations, steps, lists, settings rows — lives on the page with whitespace, type and hairline dividers. Never nest a surface inside a surface. Filled tints (`--accent-soft`, `--learn-soft`) are for state (selected, word to learn), not decoration.

### Page header (`PageHeader`)

Every top-level screen, Home included: h1 (Instrument Sans 600, 28px, 24 on phones), one muted line on what the page is for (max 62ch), actions on the right (at most one primary, plus up to two secondary or ghost). No border under it. Home's h1 is the greeting. Sub-pages (Grammar topic, Words from this text, Check the text) use the same header with a back link above the title.

The top bar does not repeat the h1: its title fades in only once the h1 has scrolled out of view (Home keeps the date there, the reader its text title).

### Disclosure (`.k-disclosure`)

Options and details that most people do not need every time sit behind a `<details>` with a chevron and a short muted summary of the current choice: Practice "Options" (remembered per device), Talk "Your own topic", Progress "By skill".

### Scrollbars

Thin and warm everywhere (`scrollbar-width: thin`, `--line-strong` thumb); tab strips scroll without a bar.

### Section header (`SectionHeader`)

h2 in Instrument Sans 600, 17px, ink; optional quiet link on the right (`.k-link`: accent text + 14px arrow). No caps overlines as section heads; `.k-overline` is only for tiny labels inside a component (inspector rows, cover kind).

### Lists

`.k-list`: rows separated by hairlines, no outer box, min row height 48px (56 with a hint line), 12px vertical padding, the row is the link with a chevron or arrow at the end. Tables (Words) follow the same look: hairline rows, 12px caps-free muted header.

### Buttons and links

- **Primary** (filled accent): one per view — the thing most people came to do (Continue reading on Home, Add text on Library, "Start · N due" on Practice, Apply on Words from this text).
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

An **image cover** (a PDF's first page, the photo of an import, or the learner's own photo, cropped to 4:5 and stored as a 600px WebP) fills the frame; the kind shrinks to its icon on a small surface plate, and the title sits on a quiet surface band at the bottom (2 lines). Without an image the typographic cover stays.

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
│ (k) vuurtoren│ Top bar (reader: title · % known · mode · Aa · …) · ⌘K · ◐ │ Inspector │
│ Home     │                                           │  (slides in)     │
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
- ⌘K / Ctrl+K: Actions (Add text, Start practice), Words (two letters or more; opens the word in Words with the inspector), Go to (every page, Exam included) and Texts.
- The rail collapses to icons below 1200px; the inspector becomes a bottom sheet below 900px.
- The inspector is closed by default and takes no space: choosing a word slides it in over the content's right edge, and the reading column moves aside (transform only, so the text never re-wraps; between 900 and 1100px it makes room instead). Esc or × closes it and the focus returns to the word.
- Below 700px a bottom tab bar replaces the rail: Home, Library, Practice, Words, More. More opens a sheet with Courses, Grammar, Talk, Progress and Settings.

## Screens

- **Home** (`/`, first screen): calm and editorial, not a dashboard; four groups above the fold. (1) The page header: Dutch greeting, "You know N Dutch words", Add text. (2) Continue reading without a box (cover, Literata title, two-line excerpt, progress, the one primary button) next to a quiet column behind a hairline: the known-words ring and three numbers. (3) Today: two or three steps as one list with hairline dividers (practise, reviews due or words waiting for Anki, course unit; done steps get a check). (4) Words to learn now (Inter word chips) and Recent texts (covers). Below: one quiet "More for today" line (grammar topic in your texts, Talk about the text, this week). A brand-new learner sees two first steps instead: Add text, and a way to bring in words they already know (Connect Anki in connected mode; import a deck file or mark words known in native mode).
- **Sign-in**: a small landing: the mark, the wordmark, one sentence on what Vuurtoren does, then the form.
- **Onboarding** (`/welcome`): "Do you use Anki?" under the welcome text, then connect Anki, choose decks, where new words go, placement or import, first text. A stepper of three fixed parts (Getting started, Your words, First text) that never changes length.
- **Library:** a bookshelf. Rows of covers that scroll sideways (snap, a hairline "shelf board" under each row, no boxes): Reading now, the learner's own shelves, To read, Finished. Where a text came from is a filter on All texts (Source: Course books, AI stories, Web, Photos & PDFs, Talk, Pasted), not more shelves, so a text appears at most twice. Under each cover one quiet line: page N of M / Finished / words, and "% known". Covers are links (middle-click opens a new tab). A "…" on each cover (on hover or focus with a pointer, always on touch) opens Open, Words from this text, Open its course unit (course texts), Edit details, Change cover, Add to shelf, Remove from this shelf, Delete. The toolbar: Shelves / All texts (segmented), Search, Sort (recent, title, coverage), Source (All texts only), New shelf, Select (multi-select with a floating bar: Add to shelf). All texts is the cover grid with words, new words, author/note and the coverage meter. Keyboard: one tab stop per row, arrow keys / Home / End inside it. Desktop: drag covers onto one of your shelves. Phones: rows stack, 128px covers, rows bleed to the screen edge.
- **Add text** (`/import`, the one way in, labelled "Add text" everywhere): tabs Paste · Web · PDF · Photo (with OCR) · Write a story (with an AI provider). A grammar topic or a unit links to Write a story with its preset. The OCR check shows Cancel and Import; Edit the whole text, Accept all suggestions and Skip review are in "…".
- **Reader:** read / cloze / gloss / side-by-side modes; the end of a text shows a calm completion panel (new words met, in Anki, still to decide) leading to Words from this text, Practise these words, Talk about this text and Next text.
- **Practice:** the header's primary is "Start · N due"; skills, length and AI sentences in Options. One exercise per screen; keys 1–4, Enter, Esc. The summary and the end of a text share one flat pattern: numbers between hairlines, one primary, the next steps as a hairline list.
- **Course unit:** a back link to the course, one primary "Continue the unit" (its first text in the reader, else the exercises) and a "…" with Talk and Write a story. Tabs: Read · Exercises · Words · Grammar. The unit's Anki actions (Study first, Add N words) sit in Words; its words open the inspector there. A book exercise has one "Check answers"; Fix answer is in each item's "…".
- **One inspector:** every Dutch word opens the same inspector, wherever it is: the reader, Words, Talk messages and new words, Practice feedback and summary, Home's word chips and a unit's words. Outside the reader, words in running text use the reader's token style with one tab stop per text.
- **Talk** (`/talk`): starts from a short list (the text you are reading, your words to learn, everyday life), your own topic behind a disclosure, earlier conversations beside it; then chat with coverage chips, inline corrections and new-word chips.
- **Words:** the hub. State / source / search filters live in the URL with removable chips; rows open the shared inspector; a selection goes to your words (or Anki), Practice or Talk. In native mode a **Due** view lists the words due now, each with a quiet "due 3 days ago" after its state. **Levels:** a Level filter (in the URL, with its chip) narrows the list to one starter level ("Level 1 · 1–500" …) or to Other words, and **Group by level** (`group=level`, a toggle next to Columns) splits the table with a header row per level: the level name in 600 weight, a muted "312 of 500 known · 48 learning" (tabular figures) and a thin known-colour bar (the coverage meter's track, at most 240px). Words outside the starter list come last under Other words. A word's level is its rank in the starter list, so levels show whether or not the starter decks exist; a native learner without them sees one muted line above the table: "Add the starter levels in Settings → Language & decks", a link there. Clear filters keeps the grouping.
- **Inspector, your reviews** (native mode): under the card's status, a quiet "Your reviews" list with hairline rows: day, answer (Again in the danger colour) and the interval it gave.
- **Grammar:** topics with "seen in your texts" examples.
- **Progress:** the numbers, then two calm charts side by side — known words over 12 weeks (a 2px `--known` line, faint area, last value labelled) and pages read per week (thin `--known` bars, this week full strength) — and Practice with "By skill" in a disclosure. Times are relative ("synced 1 hour ago"). Reached from Home ("View progress", "This week"), ⌘K and the phone's More sheet; it stays off the rail because it is a place to look back, not a daily task.
- **Settings:** sections with a sub-nav (a list on phones): Account, Language & decks (Anki connection first), Reading, AI, Data & backup, Sync (start new sync data on the first device or join it on the others, with a place and a passphrase; the devices, Sync now; on a server's page: sync tokens for devices), Advanced. Changes save themselves with a quiet "Saved" note; the theme is only in the top bar.
- **Page header:** every top-level screen opens with the same header: title (h1), one line on what the page is for, the primary action on the right.

## Voice & copy

Plain, precise and kind. "You know 96% of this text." No exclamation marks or cheerleading.

## Reader annotations and reading comforts

- **Two layers, two positions.** Word states draw at the baseline (to-learn line, learning dots, new/gloss underlines). Grammar draws a dotted row below them (`.k-tok--spot`), so both can sit on one word and still read apart without colour.
- **Margin marks** (`.k-gmark`): a 2px hairline beside the first line of a sentence worth noticing, `--state-grammar-line` at 50% (full on hover, focus or open). At most one per two sentences, never neighbours, never for very common topics (V2, de/het, plurals, perfect…). Tapping one underlines that sentence's hits and opens a popover under that line.
- **One slim reader bar** (the top bar on the reader route): the text title (UI font, muted) and "82% known" (to-learn count in its tooltip and the "…" menu), then Read | Cloze | Gloss | Side by side ("Side" below 900px), **Aa** and **…**; ⌘K and the theme stay at the end. No second toolbar, no coverage bar or coloured chip.
- **Footer**: "‹ 1 / 2 ›" (also ← → from outside the text) and one primary "Next →" ("Finish" on the last page).
- **"…" menu**: Grammar focus (the picker opens in the same popover), Focus mode, Show answers (blanks open), Simplify this page (with an AI provider), Words from this text, Keyboard shortcuts (also "?").
- **Grammar focus**: one topic at a time, picked from the "…" menu; while active a removable chip sits in the bar ("Passive · 4 ‹ › ×", under the bar on phones); Esc clears.
- **Cloze chrome**: a blank's hint button appears only on the focused blank; scores only in the completion panel.
- **"Aa" popover**: first the current mode's reading help (Gloss: Translations dial from Fewer to More, at least two translations a page unless it is off, and Blanks; Cloze: meaning above blanks; all: words to learn per page and grammar marks), then text size (5 steps, also Ctrl/Cmd + / −), line spacing, line width, font (Literata, Inter, Atkinson Hyperlegible Next) and reading theme (match app, paper, sepia, night). Per device (localStorage). Reading themes are token sets (`readingThemes.ts` in @app/ui) set inline on the reader page; every mark stays ≥ 3:1 on each.
- **Focus mode** (F, Esc to leave): sidebar and top bar (the reader bar) hidden; paragraphs other than the current one at 28% opacity (opacity transition only, none under reduced motion); the footer stays, dimmed until hovered.

## Side by side

A reading mode for meaning and word order (`SideBySide` in @app/ui).

- **Rows.** Each sentence is one row; paragraphs keep their gaps. From 900px the Dutch stands left in the reading face and the English right in the UI face, muted, at 0.8× the text size, so both columns line up sentence by sentence. Below 900px the English sits under its Dutch sentence (interlinear), smaller.
- **Pairs.** Hovering, focusing or clicking a word lights up its partners on the other side: an amber fill (`--pair-active-bg`, the accent mixed into the page) with a 2px accent underline. Both parts of a split separable verb light up together. Clicking a Dutch word also opens the word inspector; tapping an English word keeps its pair lit until the next tap. Words are real buttons named with their partner ("bel (English: call)"); ← → move along a side, ↑ ↓ jump to the partner.
- **English visibility** (Aa menu, per device): Always, Hard sentences (below 85% known, the default) or Tap to show, which puts a quiet "Show English" link in place of each English. With an AI provider, "English from AI" swaps in the provider's English.
- **Structure view.** A "Structure" link on each row (beside the English from 900px, shown on hover or focus; under the sentence below that) or Alt-click on a word. Every pair gets its own soft colour on both sides, and a note under the row names the word-order pattern ("Verb at the end. After «Omdat» …") with a 2px `--state-grammar-line` edge. The active pair adds an accent outline, so colour is never the only cue.
- **Pair palette.** Nine hues, `--pair-hue-1` … `--pair-hue-9` (amber, blue, green, rose, violet, teal, yellow, brown, slate), each with a light and a dark value. `.k-sbs` mixes them into the page colour at different strengths (24–48%) as `--pair-1` … `--pair-9`, so they follow reading themes and also differ in lightness. Text on them is `--ink`.
- **Motion.** The English fades in (`--dur-slow`); pairs light up over `--dur-pair` (180ms). Both are off under prefers-reduced-motion.
