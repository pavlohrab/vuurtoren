/**
 * Play buttons for words and sentences: `useSay()` plays a clip (or the system voice) at the
 * speed from Settings and says which item is playing, for `PlayButton`'s pulse.
 */
import { useQuery } from "@tanstack/react-query";
import { Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import type { Settings } from "../services/types.js";
import { type PlayerDeps, type Saying, browserPlayer, say, stopSaying } from "./play.js";
import "./audio.css";

/** The "nothing to play" note was shown in this session. */
let toldSilent = false;

export function useSay(player?: PlayerDeps) {
  const services = useServices();
  const toast = useToast();
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
        const how = await say(what, rate, deps);
        // Nothing could play: say so once per session, not on every tap.
        if (how === "none" && !toldSilent) {
          toldSilent = true;
          toast(
            "No recording for this one",
            "There is no Dutch voice on this device for words and sentences without a recording.",
          );
        }
        return how;
      } finally {
        if (alive.current) setPlaying((p) => (p === key ? null : p));
      }
    },
    [rate, deps, toast],
  );
  return { play, playing, settings: settings.data as Settings | undefined };
}

/** An icon button that plays something; pulses while it plays. */
export function PlayButton({
  label,
  playing,
  onPlay,
  size = "sm",
}: {
  label: string;
  playing: boolean;
  onPlay: () => void;
  size?: "sm" | "md";
}) {
  return (
    <Button
      variant="ghost"
      size={size}
      icon
      className="play-btn"
      aria-label={label}
      title={label}
      data-playing={playing || undefined}
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
    >
      <Volume2 size={16} aria-hidden />
    </Button>
  );
}
