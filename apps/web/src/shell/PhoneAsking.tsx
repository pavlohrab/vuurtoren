/**
 * "Is this your phone?" (SY12) on any screen of the computer: a phone that used the code waits
 * for this yes, and the user may have left Settings since showing the code. Closing it says no.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog } from "@app/ui";
import { currentDevice } from "../platform/index.js";

/** Sent when the user says no, so Connect a phone can say the code is used up. */
export const PHONE_REFUSED = "vuurtoren:phone-refused";

export function PhoneAsking() {
  const lan = currentDevice().bridge?.lan;
  const qc = useQueryClient();
  const asking = useQuery({
    queryKey: ["lan-asking"],
    queryFn: async () => (await lan!.asking!()) ?? null,
    enabled: !!lan?.asking,
    refetchInterval: 1000,
  });
  const reply = useMutation({
    mutationFn: ({ id, yes }: { id: string; yes: boolean }) => lan!.answer!(id, yes),
    onSuccess: async (_r, { yes }) => {
      if (!yes) window.dispatchEvent(new Event(PHONE_REFUSED));
      qc.setQueryData(["lan-asking"], null);
      await qc.invalidateQueries({ queryKey: ["lan-phones"] });
    },
  });
  const ask = asking.data;
  if (!ask) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !reply.isPending) reply.mutate({ id: ask.id, yes: false });
      }}
      title="A phone wants to connect"
      description={`${ask.name}, on your Wi-Fi. Is this your phone? It gets your data and the key to it.`}
    >
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <Button disabled={reply.isPending} onClick={() => reply.mutate({ id: ask.id, yes: false })}>
          No
        </Button>
        <Button
          variant="primary"
          disabled={reply.isPending}
          onClick={() => reply.mutate({ id: ask.id, yes: true })}
        >
          Yes, it&apos;s mine
        </Button>
      </div>
    </Dialog>
  );
}
