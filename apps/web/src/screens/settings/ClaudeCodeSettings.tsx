/**
 * Settings → AI → Use with Claude: connect Claude Code or Claude Desktop to the Vuurtoren MCP
 * server on this computer (apps/mcp, stdio), which opens the desktop app's data file, so the
 * learner's subscription can write stories, quizzes and explanations from their data. No API
 * key needed. A browser keeps its data where no other program can reach it, so there it needs
 * the desktop app.
 */
import { useAppInfo } from "../../shell/AppInfo.js";
import { CopyBlock } from "./shared.js";

const EXAMPLE_PROMPTS = [
  "Write me an A2 story using my words to learn about cycling and save it to Vuurtoren.",
  "Quiz me on Thema 3 words.",
  "Explain the grammar of this sentence, the way Vuurtoren's grammar pages do: …",
];

/** Where the built MCP server is (the user replaces it with their checkout's path). */
const MCP_SCRIPT = "/path/to/vuurtoren/apps/mcp/dist/main.js";
const INSTALL_URL = "https://github.com/pavlohrab/Vuurtoren/blob/main/docs/ai.md";

/** `claude mcp add` for the stdio server with the desktop app's data file. */
export function claudeCodeCommand(dbPath: string): string {
  return `claude mcp add vuurtoren --env VUURTOREN_DB="${dbPath}" -- node ${MCP_SCRIPT}`;
}

/** Claude Desktop config (claude_desktop_config.json) for the stdio server. */
export function claudeDesktopConfig(dbPath: string): string {
  const server = { command: "node", args: [MCP_SCRIPT], env: { VUURTOREN_DB: dbPath } };
  return JSON.stringify({ mcpServers: { vuurtoren: server } }, null, 2);
}

export function ClaudeCodeSettings() {
  const { data } = useAppInfo();
  const dbPath = data?.mode === "desktop" ? data.file?.path : undefined;

  return (
    <section className="stack" aria-label="Use with Claude">
      <h3 style={{ margin: 0 }}>Use with Claude</h3>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        No API key? Claude Code and Claude Desktop can use Vuurtoren with your Claude subscription.
        Claude then reads your known words, words to learn, courses and grammar pages, saves the
        stories it writes to your Library and suggests words, which you confirm under Words.
      </p>
      {dbPath ? (
        <>
          <p style={{ margin: 0 }}>
            Build the Vuurtoren MCP server once (
            <a href={INSTALL_URL} target="_blank" rel="noreferrer">
              how
            </a>
            ), put its path in place of <code>{MCP_SCRIPT}</code>, then add it to Claude. It opens
            this app&apos;s data file on this computer.
          </p>
          <CopyBlock label="Claude Code: run in a terminal" text={claudeCodeCommand(dbPath)} />
          <CopyBlock
            label="Claude Desktop: claude_desktop_config.json"
            text={claudeDesktopConfig(dbPath)}
          />
        </>
      ) : (
        <p className="k-hint" style={{ margin: 0 }}>
          This needs the Vuurtoren desktop app: Claude reaches your data through its data file on
          your computer. A browser keeps your data where no other program can read it. Install the
          desktop app, sync it with this browser, and set this up there.
        </p>
      )}
      <div className="stack" style={{ gap: 4 }}>
        <strong>Then ask Claude, for example:</strong>
        <ul style={{ margin: 0 }}>
          {EXAMPLE_PROMPTS.map((p) => (
            <li key={p}>“{p}”</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
