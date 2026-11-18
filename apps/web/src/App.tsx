import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ToastProvider, TooltipProvider } from "@app/ui";
import { createAppRouter } from "./router.js";
import { AppInfoProvider, type AppInfo } from "./shell/AppInfo.js";
import { ServicesProvider } from "./services/context.js";
import type { AppServices } from "./services/types.js";
import type { RouterHistory } from "@tanstack/react-router";
import { SIGNED_IN_EVENT } from "./auth/watch.js";
import { UpdateBanner } from "./pwa/PwaControls.js";

export interface AppProps extends AppInfo {
  services: AppServices;
  /** Override the router history (tests use an in-memory one). */
  history?: RouterHistory;
}

/** Root component: wires services, async state, toasts and the router. */
export function App({ services, history, notice, demo, onLeaveDemo, data, account }: AppProps) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } }),
  );
  const [router] = useState(() => createAppRouter(history));
  // After signing in again over the app (the session had ended), refetch what failed.
  useEffect(() => {
    const refetch = (): void => void queryClient.invalidateQueries();
    addEventListener(SIGNED_IN_EVENT, refetch);
    return () => removeEventListener(SIGNED_IN_EVENT, refetch);
  }, [queryClient]);
  const info: AppInfo = { notice, demo, onLeaveDemo, data, account };
  return (
    <AppInfoProvider value={info}>
      <ServicesProvider services={services}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ToastProvider>
              <RouterProvider router={router} />
              <UpdateBanner />
            </ToastProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </ServicesProvider>
    </AppInfoProvider>
  );
}
