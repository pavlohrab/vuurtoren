/**
 * Play buttons for words and sentences: `useSay()` plays a clip (or the system voice) at the
 * speed from Settings and says which item is playing, for `PlayButton`'s pulse.
 */
import { useQuery } from "@tanstack/react-query";
import { Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import type { Settings } from "../services/types.js";
import { dutchVoiceAvailable } from "../practice/speech.js";
import { type PlayerDeps, type Saying, browserPlayer, say, stopSaying } from "./play.js";
import "./audio.css";

export function useSay(player?: PlayerDeps) {
  const services = useServices();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => services.getSettings() });
  const deps = useMemo(
    () => player ?? browserPlayer((id) => services.audioClip(id)),
    [player, services],
  );
  const [playing, setPlaying] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopSaying();
    };
  }, []);
  const rate = settings.data?.audioRate ?? 1;
  const play = useCallback(
    async (key: string, what: Saying) => {
      setPlaying(key);
      try {
        return await say(what, rate, deps);
      } finally {
        if (alive.current) setPlaying((p) => (p === key ? null : p));
      }
    },
    [rate, deps],
  );
  return { play, playing, settings: settings.data as Settings | undefined };
}

/**
 * Whether there is anything to play for `what`: its recording (fetched once and kept, so the
 * play itself is instant) or a Dutch system voice. Undefined while it checks.
 */
function useCanSay(
  key: string | null,
  what: () => Promise<Saying | null> | Saying | null,
): boolean | undefined {
  const services = useServices();
  return useQuery({
    queryKey: ["can-say", key],
    enabled: key !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const w = await what();
      if (!w) return false;
      if (w.clip && (await services.audioClip(w.clip).catch(() => null))) return true;
      return !!w.text && (await dutchVoiceAvailable());
    },
  }).data;
}

/**
 * An icon button that plays something; pulses while it plays. With `check`, it finds out first
 * whether there is anything to play: when there is not, the speaker shows crossed out in red,
 * and every tap says why.
 */
export function PlayButton({
  label,
  playing,
  onPlay,
  size = "sm",
  check,
}: {
  label: string;
  playing: boolean;
  onPlay: () => void;
  size?: "sm" | "md";
  check?: { key: string; what: () => Promise<Saying | null> | Saying | null };
}) {
  const toast = useToast();
  const available = useCanSay(check?.key ?? null, check?.what ?? (() => null));
  const silent = check !== undefined && available === false;
  return (
    <Button
      variant="ghost"
      size={size}
      icon
      className={silent ? "play-btn play-btn--none" : "play-btn"}
      aria-label={silent ? `${label}: no sound` : label}
      title={silent ? "No sound for this one" : label}
      data-playing={playing || undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (silent) {
          toast(
            "No sound for this one",
            "It has no recording, and this device has no Dutch voice to read it aloud.",
          );
          return;
        }
        onPlay();
      }}
    >
      {silent ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
    </Button>
  );
}
