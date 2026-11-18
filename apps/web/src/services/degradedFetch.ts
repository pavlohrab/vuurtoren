import { DEGRADED_MESSAGES, clearDegraded, reportDegraded } from "./degraded.js";

/**
 * Fetch for the server-mode repository (review A17): a network failure or a gateway error
 * (the API behind nginx/the tunnel is down) shows as "storage" in the degraded indicator, any
 * answer clears it. The failure still reaches the caller (a user action shows its error).
 */
export const watchedFetch: typeof fetch = async (input, init) => {
  try {
    const res = await globalThis.fetch(input, init);
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      reportDegraded("storage", DEGRADED_MESSAGES.storage, `HTTP ${res.status}`);
    } else {
      clearDegraded("storage");
    }
    return res;
  } catch (e) {
    reportDegraded("storage", DEGRADED_MESSAGES.storage, e);
    throw e;
  }
};
