/**
 * Settings → AI → Use with Claude Code: connect Claude Code (or Claude Desktop) to this
 * server's MCP endpoint with a per-user token, so the learner's subscription can write
 * stories, quizzes and explanations from their Kenning data. No API key needed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input } from "@app/ui";
import {
  claudeCodeCommand,
  claudeDesktopConfig,
  createMcpTokenClient,
} from "../../auth/mcpTokens.js";
import { useAppInfo } from "../../shell/AppInfo.js";

const EXAMPLE_PROMPTS = [
  "Write me an A2 story using my words to learn about cycling and save it to Kenning.",
  "Quiz me on Thema 3 words.",
  "Explain the grammar of this sentence, the way Kenning's grammar pages do: …",
];

const client = createMcpTokenClient();

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{label}</strong>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="mcp-command" aria-label={label}>
        {text}
      </pre>
    </div>
  );
}

/** The self-hosting guide on GitHub. */
export const SELF_HOSTING_URL = "https://github.com/pavlohrab/Kenning/blob/main/deploy/README.md";

export function ClaudeCodeSettings() {
  const { data, account } = useAppInfo();
  const server = data?.mode === "server";
  const authOn = account?.authEnabled ?? false;
  const qc = useQueryClient();
  const [label, setLabel] = useState("Claude Code");
  const [fresh, setFresh] = useState<string | null>(null);
  const tokens = useQuery({
    queryKey: ["mcp-tokens"],
    queryFn: () => client.list(),
    enabled: server && authOn,
  });
  const make = useMutation({
    mutationFn: () => client.create(label),
    onSuccess: async (t) => {
      setFresh(t.token);
      await qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp-tokens"] }),
  });
  const url = `${location.origin}/api/mcp`;

  return (
    <section className="stack" aria-label="Use with Claude Code">
      <h3 style={{ margin: 0 }}>Use with Claude Code</h3>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        No API key? Claude Code and Claude Desktop can use Kenning with your Claude subscription.
        Claude then reads your known words, words to learn, courses and grammar pages, saves the
        stories it writes to your Library and suggests words for Anki, which you confirm under
        Words. It never adds cards by itself.
      </p>
      {!server ? (
        <p className="k-hint" style={{ margin: 0 }}>
          This needs Kenning running as a server, so your data is in one place Claude can reach.
          Here your data lives in this browser only.{" "}
          <a href={SELF_HOSTING_URL} target="_blank" rel="noreferrer">
            How to run Kenning as a server
          </a>
        </p>
      ) : (
        <>
          {authOn ? (
            <div className="row" style={{ alignItems: "flex-end" }}>
              <Input label="Token name" value={label} onChange={(e) => setLabel(e.target.value)} />
              <Button variant="primary" onClick={() => make.mutate()} disabled={make.isPending}>
                Generate token
              </Button>
            </div>
          ) : (
            <p className="k-hint" style={{ margin: 0 }}>
              Sign-in is off on this server, so Claude needs no token. Turn sign-in on before this
              address is reachable from the internet.
            </p>
          )}
          {make.isError ? (
            <p role="alert" className="error-text" style={{ margin: 0 }}>
              {make.error instanceof Error ? make.error.message : "That did not work."}
            </p>
          ) : null}
          {fresh || !authOn ? (
            <>
              {fresh ? (
                <p role="status" style={{ margin: 0 }}>
                  Copy it now: the token is shown only once. It opens Claude&apos;s access to
                  Kenning and nothing else.
                </p>
              ) : null}
              <CopyBlock
                label="Claude Code: run in a terminal"
                text={claudeCodeCommand(url, fresh)}
              />
              <CopyBlock
                label="Claude Desktop: claude_desktop_config.json"
                text={claudeDesktopConfig(url, fresh)}
              />
            </>
          ) : null}
          {tokens.data && tokens.data.length > 0 ? (
            <ul className="stack" aria-label="MCP tokens" style={{ margin: 0, paddingLeft: 0 }}>
              {tokens.data.map((t) => (
                <li key={t.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    {t.label}{" "}
                    <span className="k-hint">
                      made {new Date(t.createdAt).toLocaleDateString()}
                      {t.lastUsedAt
                        ? `, last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                        : ", not used yet"}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => revoke.mutate(t.id)}
                    aria-label={`Revoke ${t.label}`}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
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
