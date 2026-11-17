import * as RToast from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
}

type PushToast = (title: string, description?: string) => void;

const ToastContext = createContext<PushToast | null>(null);

/** Returns a function that shows a quiet toast (bottom-left). Needs a ToastProvider ancestor. */
export function useToast(): PushToast {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

let nextId = 1;

/** Provides toasts to the tree and renders the viewport. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback<PushToast>((title, description) => {
    const item: ToastItem = { id: nextId++, title };
    if (description) item.description = description;
    setItems((cur) => [...cur, item]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      <RToast.Provider duration={4000} swipeDirection="left">
        {children}
        {items.map((t) => (
          <RToast.Root
            key={t.id}
            className="k-toast"
            onOpenChange={(open) => {
              if (!open) setItems((cur) => cur.filter((x) => x.id !== t.id));
            }}
          >
            <RToast.Title className="k-toast-title">{t.title}</RToast.Title>
            {t.description ? (
              <RToast.Description className="k-toast-desc">{t.description}</RToast.Description>
            ) : null}
          </RToast.Root>
        ))}
        <RToast.Viewport className="k-toast-viewport" label="Notifications" />
      </RToast.Provider>
    </ToastContext.Provider>
  );
}
