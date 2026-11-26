import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyntaxDotDownload } from "./ServerStatus.js";

const base = {
  supported: true,
  installed: false,
  state: "idle",
  step: "",
  received: 0,
  error: null,
};

function show(status: Record<string, unknown>) {
  let now = { ...base, ...status };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") now = { ...now, state: "downloading", step: "the program" };
    return new Response(JSON.stringify(now), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SyntaxDotDownload nlp="http://127.0.0.1:8001" onDone={() => {}} />
    </QueryClientProvider>,
  );
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("Download SyntaxDot (SX4)", () => {
  it("offers it on a Linux computer without it, and shows the download going", async () => {
    const fetch = show({});
    await userEvent.click(await screen.findByRole("button", { name: "Download SyntaxDot" }));
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8001/admin/syntaxdot",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText(/Downloading the program/)).toBeInTheDocument();
  });

  it("says nothing where it can't run", async () => {
    const fetch = show({ supported: false });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Download SyntaxDot" })).toBeNull();
  });

  it("says what went wrong, and lets you try again", async () => {
    show({ state: "failed", error: "Needs the zstd command." });
    expect(await screen.findByText("Needs the zstd command.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download SyntaxDot" })).toBeInTheDocument();
  });
});
