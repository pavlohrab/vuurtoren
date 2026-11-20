import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockServices } from "../../services/mock.js";
import { ServicesProvider } from "../../services/context.js";
import type { AppServices } from "../../services/types.js";
import { type AppInfo, AppInfoProvider } from "../../shell/AppInfo.js";
import {
  ClaudeCodeSettings,
  claudeCodeCommand,
  claudeDesktopConfig,
} from "./ClaudeCodeSettings.js";
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

const desktopInfo: AppInfo = {
  data: {
    mode: "desktop",
    file: { path: "/home/anna/Documents/Vuurtoren/vuurtoren.sqlite" },
  } as AppInfo["data"],
};

afterEach(() => vi.unstubAllGlobals());

describe("Use with Claude", () => {
  it("builds the exact command and Desktop config for the data file", () => {
    expect(claudeCodeCommand("/d/vuurtoren.sqlite")).toBe(
      'claude mcp add vuurtoren --env VUURTOREN_DB="/d/vuurtoren.sqlite" -- node /path/to/vuurtoren/apps/mcp/dist/main.js',
    );
    const desktop = JSON.parse(claudeDesktopConfig("/d/vuurtoren.sqlite")) as {
      mcpServers: { vuurtoren: { command: string; env: Record<string, string> } };
    };
    expect(desktop.mcpServers.vuurtoren.command).toBe("node");
    expect(desktop.mcpServers.vuurtoren.env["VUURTOREN_DB"]).toBe("/d/vuurtoren.sqlite");
  });

  it("in the desktop app shows the commands with this app's data file", () => {
    wrap(<ClaudeCodeSettings />, desktopInfo);
    expect(screen.getByLabelText("Claude Code: run in a terminal").textContent).toContain(
      'VUURTOREN_DB="/home/anna/Documents/Vuurtoren/vuurtoren.sqlite"',
    );
    expect(screen.getByLabelText("Claude Desktop: claude_desktop_config.json")).toBeVisible();
  });

  it("in a browser explains that it needs the desktop app", () => {
    wrap(<ClaudeCodeSettings />, { data: { mode: "browser" } as AppInfo["data"] });
    expect(screen.getByText(/needs the Vuurtoren desktop app/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Claude Code: run in a terminal")).toBeNull();
    expect(screen.getByText(/Write me an A2 story/)).toBeInTheDocument();
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
