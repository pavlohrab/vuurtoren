import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockServices } from "../../services/mock.js";
import { ServicesProvider } from "../../services/context.js";
import type { AppServices } from "../../services/types.js";
import { type AppInfo, AppInfoProvider } from "../../shell/AppInfo.js";
import { claudeCodeCommand, claudeDesktopConfig } from "../../auth/mcpTokens.js";
import { ClaudeCodeSettings } from "./ClaudeCodeSettings.js";
import { ModelPicker } from "./ModelPicker.js";

function wrap(node: ReactNode, info: AppInfo = {}, services?: AppServices) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ServicesProvider services={services ?? createMockServices({ latencyMs: 0 })}>
        <AppInfoProvider value={info}>{node}</AppInfoProvider>
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

const serverInfo = (authEnabled: boolean): AppInfo => ({
  data: { mode: "server" } as AppInfo["data"],
  account: {
    authEnabled,
    user: "anna",
    via: "session",
    signOut: async () => {},
    signOutAll: async () => {},
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("Use with Claude Code", () => {
  it("builds the exact command and Desktop config", () => {
    expect(claudeCodeCommand("https://k.example/api/mcp", "kmcp_abc")).toBe(
      'claude mcp add --transport http kenning https://k.example/api/mcp --header "Authorization: Bearer kmcp_abc"',
    );
    expect(claudeCodeCommand("http://localhost:8080/api/mcp", null)).toBe(
      "claude mcp add --transport http kenning http://localhost:8080/api/mcp",
    );
    const desktop = JSON.parse(claudeDesktopConfig("https://k/api/mcp", "kmcp_abc")) as {
      mcpServers: { kenning: { args: string[]; env: Record<string, string> } };
    };
    expect(desktop.mcpServers.kenning.args).toContain("https://k/api/mcp");
    expect(desktop.mcpServers.kenning.env["KENNING_AUTH"]).toBe("Bearer kmcp_abc");
  });

  it("explains that browser mode needs a server", () => {
    wrap(<ClaudeCodeSettings />, { data: { mode: "browser" } as AppInfo["data"] });
    expect(screen.getByText(/needs Kenning running as a server/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate token" })).toBeNull();
    expect(screen.getByText(/Write me an A2 story/)).toBeInTheDocument();
  });

  it("generates a token, shows the command once, lists and revokes tokens", async () => {
    let tokens = [{ id: "a1b2c3d4e5f6", label: "Laptop", createdAt: 1, lastUsedAt: null }];
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (init?.method === "POST") {
          tokens = [
            ...tokens,
            { id: "ffffffffffff", label: "Claude Code", createdAt: 2, lastUsedAt: null },
          ];
          return new Response(JSON.stringify({ ok: true, id: "ffffffffffff", token: "kmcp_new" }));
        }
        if (init?.method === "DELETE") {
          tokens = tokens.filter((t) => !url.endsWith(t.id));
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify({ ok: true, tokens }));
      }),
    );
    const user = userEvent.setup();
    wrap(<ClaudeCodeSettings />, serverInfo(true));
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Generate token" }));
    const cmd = await screen.findByLabelText("Claude Code: run in a terminal");
    expect(cmd.textContent).toContain(`${location.origin}/api/mcp`);
    expect(cmd.textContent).toContain("Bearer kmcp_new");
    const list = await screen.findByRole("list", { name: "MCP tokens" });
    await user.click(within(list).getByRole("button", { name: "Revoke Laptop" }));
    await waitFor(() => expect(calls).toContain("DELETE /api/auth/mcp-tokens/a1b2c3d4e5f6"));
    await waitFor(() => expect(screen.queryByText("Laptop")).toBeNull());
  });

  it("with sign-in off shows the command without a token", () => {
    wrap(<ClaudeCodeSettings />, serverInfo(false));
    expect(screen.getByLabelText("Claude Code: run in a terminal").textContent).toBe(
      `claude mcp add --transport http kenning ${location.origin}/api/mcp`,
    );
  });
});

describe("ModelPicker", () => {
  it("offers the provider's models with the recommended default, and free text", async () => {
    const base = createMockServices({ latencyMs: 0 });
    const asked: (string | undefined)[] = [];
    const services: AppServices = {
      ...base,
      listAIModels: async (input, key) => {
        asked.push(key);
        return {
          live: true,
          options: [{ id: "gpt-5-mini", recommended: true }, { id: "gpt-5" }, { id: "o4-mini" }],
        };
      },
    };
    const onChange = vi.fn();
    const user = userEvent.setup();
    wrap(
      <ModelPicker
        provider="openai"
        baseUrl="https://api.openai.com/v1"
        value=""
        onChange={onChange}
      />,
      {},
      services,
    );
    const box = screen.getByRole("combobox", { name: "Model" });
    await user.click(box);
    const list = await screen.findByRole("listbox", { name: "Models" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["gpt-5-miniRecommended", "gpt-5", "o4-mini"]);
    expect(await screen.findByText(/3 models from your provider/)).toBeInTheDocument();
    await user.type(box, "o4");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("o4-mini");
    expect(onChange).toHaveBeenCalledWith("o"); // typing any name is allowed
  });
});
