import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EntryResult } from "@app/nlp-client";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../../services/context.js";
import { createMockServices } from "../../services/mock.js";
import { WordEntry } from "./WordEntry.js";

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

function show(result: EntryResult | null, lemma: string, pos: string, surface: string) {
  const services = { ...createMockServices({ latencyMs: 0 }), wordEntry: async () => result };
  render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={new QueryClient()}>
        <WordEntry lemma={lemma} pos={pos} surface={surface} />
      </QueryClientProvider>
    </ServicesProvider>,
  );
}

describe("WordEntry", () => {
  it("a separable verb: the short forms table, its base verb and a word with the same meaning", async () => {
    show(OPENDOEN, "opendoen", "VERB", "doet");
    expect(await screen.findByText("Forms")).toBeVisible();
    expect(screen.getByText("doe open")).toBeVisible();
    expect(screen.getByText("opengedaan")).toBeVisible();
    expect(screen.getByText("doen")).toBeVisible();
    expect(screen.getByText("openen")).toBeVisible();
    expect(screen.getByText("about A2")).toBeVisible();
    // The page's own form is marked.
    expect(screen.getByText("doet open")).toHaveAttribute("data-here");
    // No opposite in the data: no Opposite row.
    expect(screen.queryByText("Opposite")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All forms" }));
    expect(screen.getByText("doen open")).toBeVisible();
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
    expect(screen.queryByText("Forms")).toBeNull();
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
});
