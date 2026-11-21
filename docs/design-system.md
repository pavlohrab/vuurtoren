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
| Cover hover (Your texts)       | lifts 2px with a soft shadow (pointer devices only)                                                                                       |
| Progress rings and bars        | fill once on mount (coverage bars and meters)                                                                                             |
| Words tabs                     | the current tab's 2px accent line grows in from the centre (`--dur`)                                                                      |
| Dialogs, toasts, More sheet    | fade + 6px rise in; dialogs and the palette fade out (`--dur-fast`)                                                                       |
| Popovers, menus, tooltips      | scale-fade (.96 → 1) from the side they open on (`--dur-fast`)                                                                            |
| Inspector                      | slides in from the right over the content (`--dur-slow`, transform); the reading column moves aside by half its width; bottom sheet rises |
| Text covers, Words rows        | appear once in a short cascade (30 ms steps, at most 150 ms); rows fade only, so filters never jump                                       |
| Buttons, toggle chips          | 1px press on `:active`                                                                                                                    |
| Loading skeleton               | invisible for the first 150 ms (fast loads never flash), then a soft 1.2 s sweep while loading                                            |

The reader stays calm: no decorative motion while reading, only the one-time to-learn line.

## Logo

The **lighthouse**: a small tower whose beam is an `--accent` highlight bar, beside three lines of text in which one word is lit the same way. The reader does the same thing: it lights up the few words worth learning now.

- Component: `Logo` (mark + "vuurtoren" wordmark, Literata 500, as outlined paths) and `LogoMark` from `@app/ui`. `variant="mark"` for the mark alone. The tower and text lines use `currentColor` (`--ink`), the lantern, beam and lit word `--accent`; the plain text lines are `--ink` at 30% opacity.
- One 64 grid for every size (paths in `Logo.tsx`): lantern x 10–22, y 8–21; beam x 25–60, y 11.5–17.5; tower x 5.5–26.5, y 24–57 on a base at y 57–60.5; text lines at y 28, 37 and 46, the lit word x 44.5–60, y 36–41.5.
- Icons (favicon, PWA, desktop) put the mark on a `#f6f0e6` paper tile, which stays readable at 16px on light and dark tab bars.
- `ProgressRing` (12 o'clock, counter-clockwise, round caps) is for data, not branding: its fill is `--known`.

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

| Page type         | Width                   | Screens                                                                        |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Dashboard / shelf | `--w-wide` 1200px       | Read, Courses                                                                  |
| List / form       | `--w-list` 960px        | Words (all four tabs), Grammar, Talk, Settings, Add text, Words from this text |
| Reading           | `--w-read` 68ch (44rem) | Reader, Grammar topic prose column, onboarding, sign-in card                   |

Inside a page, split the grid only as 12, 8 + 4, 7 + 5 or 6 + 6. No rows with different splits stacked on one another without a section header between them. Below 900px everything is one column.

### Surfaces

A surface (`--surface` fill, hairline edge, 14px radius) only **groups interactive objects**: a dialog, the inspector, a popover, a cover, a form card that saves as one. Everything else — stats, explanations, steps, lists, settings rows — lives on the page with whitespace, type and hairline dividers. Never nest a surface inside a surface. Filled tints (`--accent-soft`, `--learn-soft`) are for state (selected, word to learn), not decoration.

### Page header (`PageHeader`)

Every top-level screen, Read included: h1 (Instrument Sans 600, 28px, 24 on phones), one muted line on what the page is for (max 62ch), actions on the right (at most one primary, plus up to two secondary or ghost). No border under it. Sub-pages (Grammar topic, Words from this text, Check the text) use the same header with a back link above the title.

The top bar does not repeat the h1: its title fades in only once the h1 has scrolled out of view (the reader keeps its text title there).

### Disclosure (`.k-disclosure`)

Options and details that most people do not need every time sit behind a `<details>` with a chevron and a short muted summary of the current choice: Practice "Options" (remembered per device), Talk "Your own topic", Progress "By skill".

### Scrollbars

Thin and warm everywhere (`scrollbar-width: thin`, `--line-strong` thumb); tab strips scroll without a bar.

### Section header (`SectionHeader`)

h2 in Instrument Sans 600, 17px, ink; optional quiet link on the right (`.k-link`: accent text + 14px arrow). No caps overlines as section heads; `.k-overline` is only for tiny labels inside a component (inspector rows, cover kind).

### Lists

`.k-list`: rows separated by hairlines, no outer box, min row height 48px (56 with a hint line), 12px vertical padding, the row is the link with a chevron or arrow at the end. Tables (Words) follow the same look: hairline rows, 12px caps-free muted header.

### Buttons and links

- **Primary** (filled accent): one per view — the thing most people came to do (Continue or Start reading in Today on Read, "Start · N due" on Practice, Apply on Words from this text). Add text on Read is secondary.
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

`TextCover` is typographic: a flat tint by source kind (paste and AI: honey, web and photo: sage, PDF and course: apricot, talk: neutral) with a darker spine on the left, the source icon and kind at the top, the title in Literata at the bottom and the coverage as a thin sage line on the bottom edge (with the percentage when there is no meter next to it). Portrait 4:5 everywhere: the Your texts shelves and the Today strip. No generated patterns.

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
┌──────────────┬───────────────────────────────────────────┬──────────────────┐
│ (k) vuurtoren│ Top bar (reader: title · % known · mode · Aa · …) · ⌘K · ◐ │ Inspector │
│ Read         │                                           │  (slides in)     │
│ Words     24 │      page content / reading column        │                  │
│ ──────────── │                                           │                  │
│ Grammar      │                                           │                  │
│ Exam         │                                           │                  │
│ Courses      │                                           │                  │
│ Talk         │                                           │                  │
│ ⚙ Settings   │                                           │                  │
└──────────────┴───────────────────────────────────────────┴──────────────────┘
```

- **Two rooms.** Navigation is built around **Read** (`/`, the landing page) and **Words** (everything about vocabulary). Read is marked on the rail for `/`, the reader and Add text; Words for `/words`, `/review`, `/practice` and `/progress`. Words carries the due count: cards due in Review in native mode, exercises due in Practice with Anki. A hairline divider, then the quieter places: Grammar, Exam, Courses, Talk (only once an AI provider is set up) and Settings at the bottom.
- Old addresses keep working: `/home` and `/library` lead to Read; `/review`, `/practice` and `/progress` are the Words tabs.
- ⌘K / Ctrl+K: Actions (Add text, Start practice), Words (two letters or more; opens the word in Words with the inspector), Go to (every page) and Texts.
- The rail collapses to icons below 1200px; the inspector becomes a bottom sheet below 900px.
- The inspector is closed by default and takes no space: choosing a word slides it in over the content's right edge, and the reading column moves aside (transform only, so the text never re-wraps; between 900 and 1100px it makes room instead). Esc or × closes it and the focus returns to the word.
- Below 700px a bottom tab bar replaces the rail: **Read · Words · More**. Words, as on the rail, opens on Review in native mode (the room's tabs Review · Your words · Practice · Progress sit at its top) and on the word list with Anki. More opens a sheet with Grammar, Exam, Courses, Talk, Progress, Settings and the theme (the top bar has no theme button on phones). Tabs are 56px tall, a 24px icon over a 12px label; the current tab is amber with an `--accent-soft` pill behind the icon. The bar sits 8px above the bottom safe area (`--tabbar-h`).
- **Safe areas** (edge to edge on phones): `--safe-top/right/bottom/left` are the larger of `env(safe-area-inset-*)` and the insets the Android app passes in. The top bar sits below `--safe-top`; the tab bar, sheets and toasts above `--safe-bottom`.
- **Word sheet** (below 900px): opens as a small **peek** (about 28–32% of the screen, measured from its content into `--sheet-peek`): the grab handle, the word with its article and the play button, the short meaning on one line, and two buttons side by side, 48px tall: **Add to my words · I know it**, or **Study first · I know it** for a word with a card. The peek ends `--safe-bottom` plus 16px above the screen's bottom, so the buttons never sit on the gesture line; the sheet covers the tab bar while it is open and the close button sits in its top corner. Everything else (the state, all meanings, decks, the sentence, your card, its reviews, grammar, Ignore) is the **expanded** state: a drag up or a tap on the handle shows it (it fades in as the sheet rises), a drag down goes back to the peek, another drag down closes, and a tap outside closes. Transform only with `--ease-spring`; no motion under reduced motion. Wider screens keep the side panel with everything in one column.
- **Reading mode on phones**: one button in the reader bar ("Gloss ▾") opens the four modes, each with one line on what it does; from 700px the segmented control.

## Screens

- **Read** (`/`, the first screen): the old Home and Library in one page. The page header ("Read", one line, Add text as a secondary button), then:
  1. **Today**, one slim strip between hairlines, its heading the Dutch greeting with the date: the text to continue (small cover, Literata title, "Page 2 of 5", the page's one primary button, Continue or Start reading); without one, a story at the learner's level ("A story at your level · A2", Start reading). Beside it, behind a hairline, two lines: reviews due with about how long they take ("24 reviews · ~6 min" → Review; with Anki: exercises due → Practise) and the current level ("Level 2 · 312 of 500 known" → Your words). Done lines show a check instead of a link. Without a language profile a "Finish setting up" bar sits above it. Below 900px the lines go under the text.
  2. **Stories for you**: the bundled graded stories. The learner's level comes first ("A1 · Start here", else "A2 · Your level": the highest level with a story that is not a stretch) as one row of cards that scrolls sideways; the other levels fold into an "Other levels" disclosure. Each card: kind and length, title, one-line summary, "You know 82%", "A stretch" when below 95%, "In your texts" once opened.
  3. **Your texts**: a bookshelf. Rows of covers that scroll sideways (snap, a hairline "shelf board" under each row, no boxes): Reading now, the learner's own shelves, To read, Finished. Where a text came from is a filter on All texts (Source: Course books, AI stories, Web, Photos & PDFs, Talk, Pasted), not more shelves, so a text appears at most twice. Under each cover one quiet line: page N of M / Finished / words, and "% known". Covers are links (middle-click opens a new tab). A "…" on each cover (on hover or focus with a pointer, always on touch) opens Open, Words from this text, Open its course unit (course texts), Edit details, Change cover, Add to shelf, Remove from this shelf, Delete. The toolbar: Shelves / All texts (segmented), Search, Sort (recent, title, coverage), Source (All texts only), New shelf, Select (multi-select with a floating bar: Add to shelf). Keyboard: one tab stop per row, arrow keys / Home / End inside it. Desktop: drag covers onto one of your shelves. Phones: rows stack, 128px covers, rows bleed to the screen edge. Empty: "No texts of your own yet", pointing at the stories above and Add text.
- **Words** (the room): four tabs that are their own routes, **Your words** (`/words`) · **Review** (`/review`, native mode, with its count) · **Practice** (`/practice`, with the exercises due) · **Progress** (`/progress`). One strip on top of all four: the tabs (underlined, a 2px accent line under the current one, counts as quiet pills) and, on the right, where the learner stands in one row ("Level 2 · 312 of 500 known", then "1,904 known · 86 learning", muted). Below 700px the summary sits above the tabs. Then each tab's own page header. A running Practice session hides the strip.
- **Your words as cards** (`/words`, the default on phones and computers; `layout=cards`): a stack, one word card at a time (the word with its article in the display face, the short meaning, the sentence it came from with the word marked, play), the next card peeking under it. Chips on top choose the words: **Met while reading** (the default), **Learning**, **New**, **Level 1 … 10**; a search icon opens the list with its search field. **Swipe right** (or →, or the **I know it** button) gives the word the same known schedule as the word sheet's I know it (an Anki-compatible mature review state); **swipe left** (or ←, or **Keep learning**) is Study first: a new card goes to the front of the new queue, a word without a card is added first, a word already being learned just goes by. A tap (or Enter) opens the word sheet. The card follows the finger with a slight rotation and an "I know it" or "Keep learning" stamp, springs away past 96px or back below it; under reduced motion it just changes. Each answer waits five seconds behind a small **Undo** toast (above the tab bar) before it is saved; the next answer or leaving the page saves it at once. On a phone the card and its two 48px buttons fit above the tab bar. A **Cards · List** toggle in the header switches to the list; a list filter in the URL (state, source, level, group, search) or `layout=list` opens the list.
- **Your words as a list** (`/words?layout=list`): state / source / search filters live in the URL with removable chips; rows open the shared inspector; a selection goes to your words (or Anki), Practice or Talk. In native mode a **Due** view lists the words due now, each with a quiet "due 3 days ago" after its state. **Levels:** a Level filter (in the URL, with its chip) narrows the list to one starter level ("Level 1 · 1–500" …) or to Other words, and **Group by level** (a toggle next to Columns) splits the table with a header row per level: the level name in 600 weight, a muted "312 of 500 known · 48 learning" (tabular figures) and a thin known-colour bar (the coverage meter's track, at most 240px). Grouping is on by default once the starter decks exist (`group=none` turns it off, `group=level` turns it on without them). Words outside the starter list come last under Other words. A native learner without the starter decks sees one muted line above a grouped table: "Add the starter levels in Settings → Your words". Clear filters keeps the grouping.
- **Review** (`/review`, a Words tab in native mode): one card at a time, Show answer, then Again / Hard / Good / Easy with the next interval on each (keys 1–4, Space), Undo (Z). Nothing due: "Read something" (primary) and "Import a deck".
- **Progress** (`/progress`, a Words tab): the numbers (estimated vocabulary once there is a record, known, learning, new, and "Known in your texts", the length-weighted coverage of the learner's texts), then two calm charts side by side — known words over 12 weeks (a 2px `--known` line, faint area, last value labelled) and pages read per week (thin `--known` bars, this week full strength) — and Practice with "By skill" in a disclosure. Times are relative ("synced 1 hour ago").
- **Sign-in**: a small landing: the mark, the wordmark, one sentence on what Vuurtoren does, then the form.
- **Onboarding** (`/welcome`): an easy start of at most three steps before reading. "Do you use Anki?" under the welcome text. **No** (the default path): Vuurtoren keeps the cards (the profile is saved with the default decks at once) → where new words start (the starter levels, Level 1/2/3/5/7) → "You are ready": Start reading opens the story at that level in the reader, "Add a text of your own" opens Add text. On a phone, **Connect to your server** (scan, link, or address and code; "Not now") comes after "Do you use Anki?": new texts and translations come from the server. Each step has Back and Continue (primary, right) with one quiet "Skip setup for now" under them; the starter levels read "Words 501–1000" with one shared line under the question. After Start reading a **walkthrough** of five coach marks (Read, a word, the reading help, Words, Review) with a soft spotlight runs once: skippable, Esc ends it, and Settings → Reading or the More sheet shows it again. While a step shows, a transparent scrim takes every tap outside the bubble, so nothing under it reacts; only the "Tap a word" step leaves its word open (a tap there opens the word and goes on). The bubble sits above sheets, dialogs and popovers (below toasts) and stays inside the safe areas; Next, Done and "Skip the tour" are its only buttons. **Yes**: keep using Anki or bring the decks in → connect Anki → choose decks → where new words go → (import, or a placement check) → ready. A stepper of three fixed parts (Getting started, Your words, Start reading) that never changes length. "Skip setup for now" still sets Vuurtoren up to keep the cards.
- **Add text** (`/import`, the one way in, labelled "Add text" everywhere): tabs Paste · Web · PDF · Photo (with OCR) · Write a story (with an AI provider); the form's button is "Add to my texts". A grammar topic or a unit links to Write a story with its preset. The OCR check shows Cancel and Import; Edit the whole text, Accept all suggestions and Skip review are in "…".
- **Reader:** read / cloze / gloss / side-by-side modes; the end of a text shows a calm completion panel (new words met, in your words or in Anki, still to decide) leading to Words from this text, Practise these words, Talk about this text and Next text.
- **Practice:** the header's primary is "Start · N due"; skills, length and AI sentences in Options. One exercise per screen; keys 1–4, Enter, Esc. The summary and the end of a text share one flat pattern: numbers between hairlines, one primary, the next steps as a hairline list.
- **Course unit:** a back link to the course, one primary "Continue the unit" (its first text in the reader, else the exercises) and a "…" with Talk and Write a story. Tabs: Read · Exercises · Words · Grammar. The unit's card actions (Study first, Add N words) sit in Words; its words open the inspector there. A book exercise has one "Check answers"; Fix answer is in each item's "…".
- **One inspector:** every Dutch word opens the same inspector, wherever it is: the reader, Words, Talk messages and new words, Practice feedback and summary, and a unit's words. Outside the reader, words in running text use the reader's token style with one tab stop per text. Its actions read the same everywhere: **Add to my words** (Add to Anki with Anki), **I know it**, **Ignore**; after Add the panel shows "Your card" at once.
- **Inspector, your reviews** (native mode): under the card's status, a quiet "Your reviews" list with hairline rows: day, answer (Again in the danger colour) and the interval it gave.
- **Talk** (`/talk`, with an AI provider): starts from a short list (the text you are reading, your words to learn, everyday life), your own topic behind a disclosure, earlier conversations beside it; then chat with coverage chips, inline corrections and new-word chips.
- **Grammar:** topics with "seen in your texts" examples.
- **Settings:** five sections with a sub-nav (a list on phones), each heading and each switch with one plain line under it: **Your words** (Anki's connection first when Anki runs the reviews; where your cards live, Starter words, new words a day per deck, review days, import and export a deck file, "Tuned to you"; FSRS is named once as "spaced review"), **Reading** (help while reading, new words per page, English under sentences, fill-in blanks, the meaning above blanks, grammar marks, the voice and its speed), **Your devices** (sync), **AI (optional)** and **Data** (backup and restore, the account on a server, and Advanced folded away: addresses, server status, install the app). Old links (`language`, `sync`, `account`, `advanced`) open the new section. Changes save themselves with a quiet "Saved" note; the theme is only in the top bar.
- **Page header:** every top-level screen opens with the same header: title (h1), one line on what the page is for, the primary action on the right.

## Voice & copy

Plain, precise and kind. "You know 96% of this text." No exclamation marks or cheerleading. Write for a new learner: short words, no jargon (say "spaced review", "your cards", "the words you know"), and in native mode never mention Anki except where the learner chooses it. One name for one thing: Read, Your texts, Stories for you, Your words, Add to my words, I know it, Review.

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
- **Pairs.** Hovering, focusing or clicking a word lights up its partners on the other side: an amber fill (`--pair-active-bg`, the accent mixed into the page) with a 2px accent underline. Both parts of a split separable verb light up together. Clicking a Dutch word also opens the word inspector and keeps its pair lit; tapping an English word keeps its pair lit until the next tap. Hover is for a mouse only: on a phone the tapped pair stays lit while the page scrolls under the word sheet. Words are real buttons named with their partner ("bel (English: call)"); ← → move along a side, ↑ ↓ jump to the partner.
- **English visibility** (Aa menu, per device): Always, Hard sentences (below 85% known, the default) or Tap to show, which puts a quiet "Show English" link in place of each English. With an AI provider, "English from AI" swaps in the provider's English.
- **Structure view.** A "Structure" link on each row (beside the English from 900px, shown on hover or focus; under the sentence below that) or Alt-click on a word. Every pair gets its own soft colour on both sides, and a note under the row names the word-order pattern ("Verb at the end. After «Omdat» …") with a 2px `--state-grammar-line` edge. The active pair adds an accent outline, so colour is never the only cue.
- **Pair palette.** Nine hues, `--pair-hue-1` … `--pair-hue-9` (amber, blue, green, rose, violet, teal, yellow, brown, slate), each with a light and a dark value. `.k-sbs` mixes them into the page colour at different strengths (24–48%) as `--pair-1` … `--pair-9`, so they follow reading themes and also differ in lightness. Text on them is `--ink`.
- **Motion.** The English fades in (`--dur-slow`); pairs light up over `--dur-pair` (180ms). Both are off under prefers-reduced-motion.
