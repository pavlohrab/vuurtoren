import * as RSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Accessible select (Radix) styled with tokens. */
export function Select({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  disabled,
}: SelectProps) {
  const id = useId();
  return (
    <div className="k-field">
      {label ? (
        <label className="k-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled ?? false}>
        <RSelect.Trigger id={id} className="k-select-trigger">
          <RSelect.Value {...(placeholder ? { placeholder } : {})} />
          <RSelect.Icon>
            <ChevronDown size={16} />
          </RSelect.Icon>
        </RSelect.Trigger>
        <RSelect.Portal>
          <RSelect.Content className="k-select-content" position="popper" sideOffset={4}>
            <RSelect.Viewport>
              {options.map((o) => (
                <RSelect.Item key={o.value} value={o.value} className="k-select-item">
                  <RSelect.ItemText>{o.label}</RSelect.ItemText>
                  <RSelect.ItemIndicator>
                    <Check size={14} />
                  </RSelect.ItemIndicator>
                </RSelect.Item>
              ))}
            </RSelect.Viewport>
          </RSelect.Content>
        </RSelect.Portal>
      </RSelect.Root>
    </div>
  );
}
