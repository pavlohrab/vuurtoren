/** Run the FSRS optimizer in a worker (browser and desktop app; works offline). */
import type { TrainingSequence } from "@app/core";
import type { OptimizeResult } from "./optimize.js";

export type RunOptimizer = (
  seqs: TrainingSequence[],
  current: number[],
  onProgress?: (done: number, total: number) => void,
) => Promise<OptimizeResult>;

export const workerOptimizer: RunOptimizer = (seqs, current, onProgress) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./optimizer.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (
      ev: MessageEvent<{ progress?: [number, number]; result?: OptimizeResult; error?: string }>,
    ) => {
      if (ev.data.progress) onProgress?.(...ev.data.progress);
      else {
        worker.terminate();
        if (ev.data.result) resolve(ev.data.result);
        else reject(new Error(ev.data.error ?? "The optimizer stopped."));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "The optimizer could not start."));
    };
    worker.postMessage({ seqs, current });
  });
