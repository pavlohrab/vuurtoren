/**
 * Settings → AI model picker: a searchable combobox over the provider's model list (fetched
 * with the key when the provider allows it from the browser, else a curated list), with the
 * preset's default marked "Recommended". Any other name can still be typed.
 */
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ProviderId } from "@app/ai";
import { useServices } from "../services/context.js";
import { useDebounced } from "../useDebounced.js";

export interface ModelPickerProps {
  provider: ProviderId;
  baseUrl: string;
  value: string;
  onChange: (model: string) => void;
  /** A key typed but not yet saved: used to list models right away. */
  keyDraft?: string;
}

export function ModelPicker({ provider, baseUrl, value, onChange, keyDraft }: ModelPickerProps) {
  const services = useServices();
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const key = useDebounced(keyDraft?.trim() ?? "", 600);
  const address = useDebounced(baseUrl, 600);
  const models = useQuery({
    queryKey: ["ai-models", provider, address, key],
    queryFn: () => services.listAIModels({ provider, baseUrl: address }, key || undefined),
    staleTime: Infinity,
    gcTime: key ? 0 : 5 * 60_000,
  });
  const options = models.data?.options ?? [];
  const q = (filter ?? "").toLowerCase().trim();
  const shown = options
    .filter((m) => !q || m.id.toLowerCase().includes(q) || m.label?.toLowerCase().includes(q))
    .slice(0, 60);

  const pick = (model: string) => {
    onChange(model);
    setFilter(null);
    setOpen(false);
  };

  return (
    <div className="k-field model-picker">
      <label className="k-label" htmlFor={id}>
        Model
      </label>
      <input
        id={id}
        className="k-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setFilter(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && shown.length > 0 ? (
        <ul id={listId} role="listbox" aria-label="Models" className="model-picker-list">
          {shown.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={m.id === value}
              data-active={i === active ? "" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m.id);
              }}
            >
              <span className="model-picker-id">{m.id}</span>
              {m.label ? <span className="k-hint"> {m.label}</span> : null}
              {m.recommended ? <span className="model-picker-badge">Recommended</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="k-hint">
        {models.isLoading
          ? "Loading your provider's models…"
          : models.data?.live
            ? `${options.length} models from your provider. Type to search; any name works.`
            : "Suggested models. With a key (and a provider that allows it) the full list appears here. Any name works."}
      </span>
    </div>
  );
}
