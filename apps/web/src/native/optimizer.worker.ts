/** The FSRS optimizer in its own worker: training takes seconds and must not block the page. */
import type { TrainingSequence } from "@app/core";
import { type FsrsOptimizerModule, optimize } from "./optimize.js";

// The handler is set before the module is loaded: the optimizer's loader waits on the .wasm
// (top-level await), and a message arriving before a handler exists would be lost.
const binding = import("@open-spaced-repetition/binding-wasm32-wasip1");

self.onmessage = async (ev: MessageEvent<{ seqs: TrainingSequence[]; current: number[] }>) => {
  try {
    const mod = (await binding) as unknown as FsrsOptimizerModule;
    const result = await optimize(mod, ev.data.seqs, ev.data.current, (done, total) =>
      self.postMessage({ progress: [done, total] }),
    );
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
