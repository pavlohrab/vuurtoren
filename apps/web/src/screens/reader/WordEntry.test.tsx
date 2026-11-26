import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EntryResult } from "@app/nlp-client";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../../services/context.js";
import { createMockServices } from "../../services/mock.js";
import type { InspectorEntry } from "@app/core";
import {
  CardExtra,
  levelLine,
  CardForms,
  CardMeaning,
  CardRelated,
  CardSenses,
  FullEntry,
  useWordEntry,
} from "./WordEntry.js";

const OPENDOEN: EntryResult = {
  word: "opendoen",
  entries: [
    {
      pos: "verb",
      article: null,
      glosses: ["to open"],
      forms: {
        participle: "opengedaan",
        past: ["deed open", "deden open"],
        present: { ik: "doe open", jij: "doet open", hij: "doet open", wij: "doen open" },
        separable: { particle: "open", stem: "doen" },
      },
      extras: { senses: [{ gloss: "to open", synonyms: ["openen"] }] },
      base: "doen",
      level: "A2",
    },
  ],
};

/** The card's dictionary parts, put together as the reader does. */
function Parts({ lemma, pos, surface }: { lemma: string; pos: string; surface: string }) {
  const entry = useWordEntry(lemma, pos);
  if (!entry) return null;
  return (
    <>
      <CardForms entry={entry} surface={surface} />
      <CardRelated entry={entry} />
      <CardExtra entry={entry} full={false} onFull={() => {}} />
    </>
  );
}

function show(result: EntryResult | null, lemma: string, pos: string, surface: string) {
  const services = { ...createMockServices({ latencyMs: 0 }), wordEntry: async () => result };
  render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={new QueryClient()}>
        <Parts lemma={lemma} pos={pos} surface={surface} />
      </QueryClientProvider>
    </ServicesProvider>,
  );
}

const word = (over: Partial<InspectorEntry>): InspectorEntry =>
  ({ surface: "even", lemma: "even", glosses: [], ...over }) as InspectorEntry;

describe("WordEntry", () => {
  it("a separable verb: the short forms table, its base verb and a word with the same meaning", async () => {
    show(OPENDOEN, "opendoen", "VERB", "doet");
    expect(await screen.findByText("doe open")).toBeVisible();
    expect(screen.getByText("opengedaan")).toBeVisible();
    expect(screen.getByText("doen")).toBeVisible();
    expect(screen.getByText("openen")).toBeVisible();
    expect(screen.getByText("about A2")).toBeVisible();
    // The page's own form is marked; a tapped form says what it is.
    expect(screen.getByText("doet open").closest("tr")).toHaveAttribute("data-here");
    await userEvent.click(screen.getByRole("button", { name: "deed open" }));
    expect(screen.getByRole("status")).toHaveTextContent("deed open · past, ik/hij/zij");
    // No opposite in the data: no Opposite row.
    expect(screen.queryByText("Opposite")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All forms" }));
    expect(screen.getByText("doen open")).toBeVisible();
    // The order of all forms; a separable verb joins up in a subordinate clause.
    expect(screen.getByText("… opendoet")).toBeVisible();
  });

  it("a noun shows its plural and small form; nothing else is there", async () => {
    show(
      {
        word: "burgemeester",
        entries: [
          {
            pos: "noun",
            article: "de",
            glosses: ["mayor"],
            forms: { plural: "burgemeesters", diminutive: "burgemeestertje" },
          },
        ],
      },
      "burgemeester",
      "NOUN",
      "burgemeester",
    );
    expect(await screen.findByText("burgemeesters")).toBeVisible();
    expect(screen.queryByText("Same meaning")).toBeNull();
    expect(screen.queryByRole("button", { name: "All forms" })).toBeNull();
  });

  it("shows nothing when the dictionary has nothing", async () => {
    show(null, "wegmoeten", "VERB", "moet");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("the perfect with its helper when it is known (is gegaan)", async () => {
    show(
      {
        word: "gaan",
        entries: [
          {
            pos: "verb",
            article: null,
            glosses: ["to go"],
            forms: { participle: "gegaan", aux: "zijn", present: { ik: "ga", hij: "gaat" } },
          },
        ],
      },
      "gaan",
      "VERB",
      "gaat",
    );
    expect(await screen.findByText("is gegaan")).toBeVisible();
    expect(screen.getByText("perfect")).toBeVisible();
  });

  it("the full entry: what the card leaves out, the sentence's meaning first and marked", () => {
    const entry = {
      ...OPENDOEN.entries[0]!,
      extras: {
        senses: [
          { gloss: "to answer the door" },
          { gloss: "to open", examples: [{ nl: "Doe het raam open.", en: "Open the window." }] },
          { gloss: "an old meaning", mark: "old" as const },
        ],
      },
    };
    render(<FullEntry entry={entry} word={word({ surface: "doet", glosses: ["to open"] })} />);
    expect(screen.getByText("verb · separable · about A2")).toBeVisible();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("to open");
    expect(items[0]).toHaveTextContent("in your sentence");
    expect(items[0]).toHaveTextContent("Open the window.");
    expect(items[2]).toHaveTextContent("old");
  });

  it("the meaning: one line, or Here and Dictionary when they differ", () => {
    const { rerender } = render(<CardMeaning word={word({ glosses: ["to open"] })} />);
    expect(screen.queryByText("Here")).toBeNull();
    expect(screen.getByText("to open")).toBeVisible();
    rerender(
      <CardMeaning
        word={word({ glosses: ["equal, even; just"], sentenceGloss: "for a moment" })}
      />,
    );
    expect(screen.getByText("Here")).toBeVisible();
    expect(screen.getByText("for a moment")).toBeVisible();
    expect(screen.getByText("equal, even; just")).toBeVisible();
  });

  it("the meanings as a dictionary has them: numbered, this sentence's marked, the rest folded", async () => {
    const entry = {
      word: "doen",
      pos: "verb",
      glosses: [],
      extras: {
        senses: [
          { gloss: "to do" },
          {
            gloss: "to put",
            examples: [{ nl: "Doe dat daar maar in.", en: "Just put it in there." }],
          },
          { gloss: "to make" },
          { gloss: "to give, serve" },
          { gloss: "to behave", synonyms: ["handelen"] },
        ],
      },
    } as unknown as Parameters<typeof CardSenses>[0]["entry"];
    render(
      <CardSenses
        word={word({ glosses: ["to put"], glossNote: "in this sentence" })}
        entry={entry}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("in this sentence")).toBeVisible();
    expect(screen.getByText("Doe dat daar maar in.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "2 more meanings" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("handelen")).toBeVisible();
  });
});

describe("how common a word is, beside its level (LV9)", () => {
  it("says both, either, or nothing", () => {
    expect(levelLine(6.1, "A1")).toBe("very common · about A1");
    expect(levelLine(3.4, undefined)).toBe("less common");
    expect(levelLine(undefined, "B2")).toBe("about B2");
    expect(levelLine(0, null)).toBe("");
  });
});
