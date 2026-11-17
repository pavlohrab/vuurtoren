import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PRESETS, presetFor, type ProviderId } from "@app/ai";
import { Button, Input, Select, Spinner } from "@app/ui";
import { useServices } from "../services/context.js";
import type { AISettings as AISettingsData } from "../services/aiTypes.js";

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");

/** Settings > AI: provider, model, key (stored on this device only), test and spend note. */
export function AISettings() {
  const services = useServices();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["ai-settings"], queryFn: () => services.getAISettings() });
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const usage = useQuery({ queryKey: ["ai-usage"], queryFn: () => services.aiUsage() });
  const [draft, setDraft] = useState<AISettingsData | null>(null);
  const [key, setKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [unlockPass, setUnlockPass] = useState("");
  const form = draft ?? saved.data ?? null;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["ai-settings"] });
    await qc.invalidateQueries({ queryKey: ["ai-status"] });
    await qc.invalidateQueries({ queryKey: ["ai-usage"] });
  };
  const persist = async () => {
    if (!form) return;
    await services.saveAISettings(form);
    if (key.trim()) {
      await services.saveAIKey(key.trim(), passphrase || undefined);
      setKey("");
      setPassphrase("");
    }
    await refresh();
  };
  const save = useMutation({ mutationFn: persist });
  const test = useMutation({
    mutationFn: async () => {
      await persist();
      return services.testAI();
    },
    onSettled: () => void refresh(),
  });
  const clear = useMutation({
    mutationFn: async () => {
      await services.clearAIKey();
      await refresh();
    },
  });
  const unlock = useMutation({
    mutationFn: async () => {
      await services.unlockAI(unlockPass);
      setUnlockPass("");
      await refresh();
    },
  });

  if (!form) return null;
  const preset = presetFor(form.provider);
  const st = status.data;
  const set = (patch: Partial<AISettingsData>) => setDraft({ ...form, ...patch });
  const pickProvider = (id: string) => {
    const p = presetFor(id as ProviderId);
    set({ provider: p.id, baseUrl: p.baseUrl, model: p.defaultModel });
  };

  return (
    <section className="stack" style={{ marginTop: 40 }} aria-labelledby="ai-h">
      <h2 id="ai-h" style={{ fontSize: 19 }}>
        AI
      </h2>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        Optional. Conversation, sentence explanations and page simplification use your own account
        with a provider. Your key stays on this device (also when you use a server) and is never
        saved in your data, backups or sync.
      </p>
      <div style={{ maxWidth: 320 }}>
        <Select
          label="Provider"
          value={form.provider}
          options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          onValueChange={pickProvider}
        />
      </div>
      <p className="k-hint" style={{ margin: 0 }}>
        {preset.note}
      </p>
      <Input
        label="Address"
        value={form.baseUrl}
        onChange={(e) => set({ baseUrl: e.target.value })}
      />
      <Input
        label="Model"
        value={form.model}
        hint="A cheap, fast model is plenty. Names change; check your provider's list."
        onChange={(e) => set({ model: e.target.value })}
      />
      {preset.needsKey || st?.keySaved ? (
        <>
          <Input
            label="API key"
            type="password"
            autoComplete="off"
            value={key}
            placeholder={st?.keySaved ? "A key is saved on this device" : ""}
            onChange={(e) => setKey(e.target.value)}
          />
          <Input
            label="Passphrase (optional)"
            type="password"
            autoComplete="off"
            value={passphrase}
            hint="Encrypts the key on this device. You enter it once per session. Without it the key is stored as plain text in this browser."
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </>
      ) : null}
      {st?.locked ? (
        <div className="row">
          <Input
            label="Unlock saved key"
            type="password"
            value={unlockPass}
            onChange={(e) => setUnlockPass(e.target.value)}
          />
          <Button onClick={() => unlock.mutate()} disabled={unlock.isPending || !unlockPass}>
            Unlock
          </Button>
        </div>
      ) : null}
      {unlock.isError ? (
        <span role="alert" className="error-text">
          {message(unlock.error)}
        </span>
      ) : null}
      <Input
        label="Monthly spend note"
        value={form.budgetNote}
        hint="Your own reminder, e.g. “max $5”. Set the real limit in your provider's dashboard."
        onChange={(e) => set({ budgetNote: e.target.value })}
      />
      <div className="row">
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save AI settings
        </Button>
        <Button onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <Spinner label="Testing" /> : null}
          Test
        </Button>
        {st?.keySaved ? (
          <Button variant="ghost" onClick={() => clear.mutate()}>
            Remove key
          </Button>
        ) : null}
      </div>
      {save.isSuccess && !save.isPending ? <p role="status">AI settings saved.</p> : null}
      {test.isSuccess ? (
        <p role="status" style={{ margin: 0 }}>
          Works: the model answered “{test.data.text}” in {test.data.ms} ms.
        </p>
      ) : null}
      {test.isError || save.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(test.error ?? save.error)}
        </p>
      ) : null}
      {usage.data ? (
        <p className="k-hint" style={{ margin: 0 }}>
          This month on this device: {usage.data.calls} requests, about{" "}
          {usage.data.inputTokens.toLocaleString("en")} tokens in and{" "}
          {usage.data.outputTokens.toLocaleString("en")} out. A 20-message conversation with a small
          model costs well under a cent; this is a rough count, not your bill.
        </p>
      ) : null}
    </section>
  );
}
