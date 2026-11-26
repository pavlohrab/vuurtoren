/**
 * One plain line in the word card when this phone has no dictionary yet (m5, OB3): meanings and
 * forms then come only from the text, so say where to get it. Nothing on a computer.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { currentDevice } from "../../platform/index.js";

export function DictionaryMissing() {
  const pack = currentDevice().bridge?.dictionary ?? null;
  const status = useQuery({
    queryKey: ["dictionary-pack", "status"],
    queryFn: () => pack!.status(),
    enabled: !!pack,
    refetchInterval: (q) => (q.state.data?.installed ? false : 5000),
  });
  if (!pack || !status.data || status.data.installed) return null;
  return (
    <p className="k-hint word-dict-missing">
      {status.data.downloading
        ? "The dictionary is still downloading. Meanings get better when it's in."
        : "No dictionary on this phone yet. "}
      {status.data.downloading ? null : (
        <Link to="/settings" search={{ section: "reading" }} className="k-link">
          Get it (Reading) →
        </Link>
      )}
    </p>
  );
}
