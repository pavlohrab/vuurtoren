import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.js";

describe("Markdown", () => {
  it("renders an AI answer: headings and lists without blank lines, bold and *italic*", () => {
    const { container } = render(
      <Markdown
        source={
          "## Meaning\nThe mayor looked at the **tower**.\n## Grammar\n- *keek* is past tense\n- verb second"
        }
      />,
    );
    expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
      "Meaning",
      "Grammar",
    ]);
    expect(container.querySelector("strong")?.textContent).toBe("tower");
    expect(container.querySelector("em")?.textContent).toBe("keek");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/[#*]/);
  });

  it("keeps the topic pages' own format", () => {
    const { container } = render(
      <Markdown source={"### Rule\n\nUse _de_ here.\n\n1. one\n2. two"} />,
    );
    expect(container.querySelector("h3")?.textContent).toBe("Rule");
    expect(container.querySelector("em")?.textContent).toBe("de");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });
});
