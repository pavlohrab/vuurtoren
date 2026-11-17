# Design system — professional, warm, subtle

## Principles

1. **Reading first.** The text is the hero; chrome recedes.
2. **Quiet by default.** Information appears on demand: hover, click, inspector.
3. **No gamification theatre.** No mascots, streak guilt, confetti or badges. Progress is shown with calm, honest charts.
4. **Keyboard-first and accessible.** WCAG AA contrast, visible focus, `prefers-reduced-motion` respected.
5. **One system everywhere.** Web, desktop and extension share the same tokens and components.

## Typography

All faces are self-hosted via Fontsource (no Google CDN, for privacy) and cover **Latin + Cyrillic**.

| Role         | Face                                     | Size / leading          |
| ------------ | ---------------------------------------- | ----------------------- |
| Reading text | **Literata** (variable serif)            | 19–20px / 1.7, max 66ch |
| UI           | **Inter** (variable, `tnum` for numbers) | 14–15px / 1.45          |
| Data / mono  | **JetBrains Mono**                       | 13px                    |

Scale (ratio 1.2): 12 · 14 · 16 · 19 · 23 · 28 · 34. Headings use Inter at 600, never all caps except for tiny overline labels (11px, +0.06em).

## Color tokens

CSS custom properties are exposed to Tailwind v4 via `@theme`. Dark mode is a warm charcoal, not pure black.

| Token           | Light   | Dark    | Use                           |
| --------------- | ------- | ------- | ----------------------------- |
| `--bg`          | #F8F5EF | #181512 | page, paper                   |
| `--surface`     | #FFFDF9 | #211D19 | cards, panels                 |
| `--surface-2`   | #F1ECE3 | #2A2520 | hover, sidebar                |
| `--ink`         | #1F1B16 | #ECE6DC | body text                     |
| `--ink-muted`   | #6B6259 | #A39A8F | secondary text                |
| `--line`        | #E6DED2 | #342E28 | borders, dividers             |
| `--accent`      | #2F6F6A | #6FB3AC | primary actions, links, focus |
| `--accent-warm` | #B5562E | #E08A62 | highlights, "new" emphasis    |
| `--success`     | #3F7D4E | #7DB88B | correct                       |
| `--danger`      | #A63D3D | #E08080 | wrong, destructive            |

### Word-state semantics (the heart of the reader)

| State                                            | Treatment                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| new / target                                     | soft amber tint `#F3E3C3` (dark `#4A3A1F`) + 1px underline `#9A6A12`                  |
| learning                                         | dotted underline sage `#5E8B6B`; opacity = 1 − recall (fades as you master it)        |
| known                                            | no decoration                                                                         |
| ignored / proper noun                            | no decoration, never clickable-highlighted                                            |
| weave island (target-language word in base text) | small-caps-free, 1px teal underline; hover shows the gloss                            |
| cloze                                            | hairline-bordered blank sized to the word length; focused blank gets an accent border |

Never use bright highlighter blocks.

## Shape, depth, motion

- Spacing on a 4px grid (4, 8, 12, 16, 24, 32, 48).
- Radius: 6px for controls, 10px for cards, 999px for chips.
- 1px borders do the separation; shadows only on popovers and dialogs (`0 8px 24px rgb(0 0 0 / .08)`).
- Motion: 150–200ms, ease-out; no bouncing; disabled under reduced motion.
- Icons: **Lucide**, 1.5px stroke, 16/20px.

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
┌────────┬───────────────────────────────────────────┬──────────────────┐
│ Sidebar│  Top bar: title · coverage 96.4% · 5 new  │  Inspector panel │
│ Library│  · mode [Read|Cloze|Gloss|Weave] · ⌘K     │  lemma, gloss,   │
│ Read   │                                           │  forms, Anki     │
│ Practice│      centered reading column (66ch)       │  state, recall,  │
│ Converse│      Literata, generous margins           │  grammar tags,   │
│ Words  │                                           │  [Add to Anki]   │
│ Grammar│     Density dial (weave): EN ───●─── NL   │  (collapsible)   │
│ Progress│                                          │                  │
│ ⚙      │                                           │                  │
└────────┴───────────────────────────────────────────┴──────────────────┘
```

- The sidebar collapses to icons below 1200px.
- The inspector becomes a bottom sheet below 900px, which also covers future mobile.
- The extension side panel reuses the `WordInspector` panel.
- Parallel view (original | weave) splits the reading column into two 50ch columns.

## Screens

- **Onboarding:** connect AnkiConnect, choose note type and word field with a live preview, choose language, short placement check.
- **Library:** cards per text with coverage, new-word count and difficulty band.
- **Import:** paste, URL, PDF, photo; editable OCR preview.
- **Reader:** read / cloze / gloss / weave modes; end-of-text "Words from this text" list.
- **Practice:** one exercise per screen; keys 1–4, Enter, Esc.
- **Converse:** chat with coverage chips, inline corrections and new-word chips.
- **Words:** filterable lemma table.
- **Grammar:** topics with "seen in your texts" examples.
- **Progress:** vocabulary estimate, coverage trend, CEFR estimate.
- **Settings:** Anki, AI providers, translation engine, sync, data export.

## Voice & copy

Plain, precise and kind. "You know 96% of this text." No exclamation marks or cheerleading.
