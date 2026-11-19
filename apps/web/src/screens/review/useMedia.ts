import { useEffect, useState } from "react";
import { useServices } from "../../services/context.js";

/** Object URLs for a card's media (file name → URL), revoked when the card changes. */
export function useMediaUrls(media: Readonly<Record<string, string>>): Record<string, string> {
  const services = useServices();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = JSON.stringify(media);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    const entries = Object.entries(JSON.parse(key) as Record<string, string>);
    void Promise.all(
      entries.map(async ([name, id]) => {
        const blob = await services.mediaFile(id).catch(() => null);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        made.push(url);
        return [name, url] as const;
      }),
    ).then((pairs) => {
      if (alive) setUrls(Object.fromEntries(pairs.filter((p) => p !== null)));
    });
    return () => {
      alive = false;
      for (const u of made) URL.revokeObjectURL(u);
      setUrls({});
    };
  }, [key, services]);
  return urls;
}
