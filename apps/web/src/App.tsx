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
export function App({
  services,
  history,
  notice,
  demo,
  onLeaveDemo,
  data,
  account,
  desktop,
}: AppProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Local first: the data is on this device, so a query runs whether or not the phone
          // is online. React Query's default ("online") paused every query when the network
          // dropped while the app was open: the reader then waited forever in airplane mode.
          // Calls that need the network fail on their own and say why.
          queries: { retry: false, staleTime: 5_000, networkMode: "always" },
          mutations: { networkMode: "always" },
        },
      }),
  );
  const [router] = useState(() => createAppRouter(history));
  // After signing in again over the app (the session had ended), refetch what failed.
  useEffect(() => {
    const refetch = (): void => void queryClient.invalidateQueries();
    addEventListener(SIGNED_IN_EVENT, refetch);
    return () => removeEventListener(SIGNED_IN_EVENT, refetch);
  }, [queryClient]);
  const info: AppInfo = { notice, demo, onLeaveDemo, data, account, desktop };
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
