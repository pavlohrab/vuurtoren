/**
 * Root route: the app shell, or the full-page onboarding at /welcome. A new learner (no language
 * profile, not in ?demo, has not skipped setup) is sent to onboarding once.
 */
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServices } from "../services/context.js";
import { onboardingSkipped } from "../screens/onboarding/skip.js";
import { AppShell } from "./AppShell.js";
import { useAppInfo } from "./AppInfo.js";

export function Root() {
  const services = useServices();
  const { demo } = useAppInfo();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Choose shell or no shell by the route actually rendered, not by the location: while a
  // navigation to /welcome is pending (its screen is code-split), the location is already
  // /welcome but the Outlet still renders the previous screen, which needs the shell.
  const welcomeShown = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId === "/welcome"),
  });
  const profile = useQuery({
    queryKey: ["languageProfile"],
    queryFn: () => services.languageProfile(),
    enabled: !demo,
    staleTime: Infinity,
  });
  const needsSetup = !demo && profile.data === null && !onboardingSkipped();
  useEffect(() => {
    if (needsSetup && path !== "/welcome") void navigate({ to: "/welcome", replace: true });
  }, [needsSetup, path, navigate]);

  if (welcomeShown) return <Outlet />;
  return <AppShell />;
}
