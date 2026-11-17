import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AddToAnki, type DeckOption, shortDeck } from "./AddToAnki.js";

const options: DeckOption[] = [
  { deck: "Kenning::Nederlands::Reading", group: "kenning", hint: "Reading" },
  { deck: "Kenning::Nederlands", group: "kenning", hint: "Default" },
  { deck: "Kenning::Nederlands::Boek::Les 1", group: "course", hint: "Les 1" },
  { deck: "Dutch 5000", group: "anki" },
];

function Harness({ onAdd }: { onAdd: (deck: string) => void }) {
  const [deck, setDeck] = useState("Kenning::Nederlands::Reading");
  return (
    <AddToAnki deck={deck} options={options} onDeckChange={setDeck} onAdd={() => onAdd(deck)} />
  );
}

describe("AddToAnki", () => {
  it("names the destination deck and adds there", async () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    const main = screen.getByRole("button", { name: /Add to …::Nederlands::Reading/ });
    expect(main).toHaveAttribute("title", "Add to Kenning::Nederlands::Reading");
    await userEvent.click(main);
    expect(onAdd).toHaveBeenCalledWith("Kenning::Nederlands::Reading");
  });

  it("picks another deck from the grouped list", async () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: /Choose the deck/ }));
    expect(screen.getByRole("group", { name: "Course decks" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Kenning::Nederlands::Reading/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(screen.getByRole("option", { name: /Dutch 5000/ }));
    await userEvent.click(screen.getByRole("button", { name: /Add to Dutch 5000/ }));
    expect(onAdd).toHaveBeenCalledWith("Dutch 5000");
  });

  it("creates a new deck name", async () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: /Choose the deck/ }));
    await userEvent.click(screen.getByRole("button", { name: /New deck/ }));
    const input = screen.getByRole("textbox", { name: "New deck name" });
    expect(input).toHaveValue("Kenning::Nederlands::");
    await userEvent.type(input, "Podcasts{Enter}");
    await userEvent.click(screen.getByRole("button", { name: /Add to …::Nederlands::Podcasts/ }));
    expect(onAdd).toHaveBeenCalledWith("Kenning::Nederlands::Podcasts");
  });

  it("works as a picker only and shortens deep names", async () => {
    const onDeckChange = vi.fn();
    render(<AddToAnki deck="Kenning::Nederlands" options={options} onDeckChange={onDeckChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Add to Kenning::Nederlands" }));
    await userEvent.click(screen.getByRole("option", { name: /Les 1/ }));
    expect(onDeckChange).toHaveBeenCalledWith("Kenning::Nederlands::Boek::Les 1");
    expect(shortDeck("A::B::C::D")).toBe("…::C::D");
  });
});
