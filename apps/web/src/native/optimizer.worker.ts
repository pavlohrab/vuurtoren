/** The FSRS optimizer in its own worker: training takes seconds and must not block the page. */
import * as binding from "@open-spaced-repetition/binding-wasm32-wasip1";
import type { TrainingSequence } from "@app/core";
import { type FsrsOptimizerModule, optimize } from "./optimize.js";

self.onmessage = async (ev: MessageEvent<{ seqs: TrainingSequence[]; current: number[] }>) => {
  try {
    const result = await optimize(
      binding as unknown as FsrsOptimizerModule,
      ev.data.seqs,
      ev.data.current,
      (done, total) => self.postMessage({ progress: [done, total] }),
    );
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
