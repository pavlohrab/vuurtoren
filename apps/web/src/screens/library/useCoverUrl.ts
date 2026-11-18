import { useQuery } from "@tanstack/react-query";
import { useServices } from "../../services/context.js";

/**
 * An object URL for a text's cover image (null while loading, or without one). Covers are
 * content-addressed, so one URL per id is made once and kept for the page's lifetime (a few
 * dozen small WebPs at most).
 */
export function useCoverUrl(coverId: string | undefined): string | null {
  const services = useServices();
  const url = useQuery({
    queryKey: ["cover", coverId],
    queryFn: async () => {
      const blob = await services.coverImage(coverId!);
      return blob ? URL.createObjectURL(blob) : null;
    },
    enabled: coverId !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  return coverId === undefined ? null : (url.data ?? null);
}
