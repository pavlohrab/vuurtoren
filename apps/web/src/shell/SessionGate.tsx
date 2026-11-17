import { useEffect, useState, type ReactNode } from "react";
import type { AuthMethod, Credentials, SignInResult } from "../auth/client.js";
import { onUnauthorized, SIGNED_IN_EVENT } from "../auth/watch.js";
import { SignInScreen } from "./SignIn.js";

/**
 * The app plus the session watch: when a request answers 401 the sign-in screen is laid over
 * the app, which stays mounted (same route, same unsaved input). After signing in the app
 * refetches its data.
 */
export function SessionGate({
  children,
  methods,
  user,
  signIn,
}: {
  children: ReactNode;
  methods: readonly AuthMethod[] | undefined;
  user: string | null;
  signIn: (c: Credentials) => Promise<SignInResult>;
}) {
  const [ended, setEnded] = useState(false);
  useEffect(() => onUnauthorized(() => setEnded(true)), []);
  return (
    <>
      <div inert={ended} aria-hidden={ended || undefined} style={{ display: "contents" }}>
        {children}
      </div>
      {ended ? (
        <SignInScreen
          reason="expired"
          methods={methods ?? ["password"]}
          defaultUser={user}
          signIn={signIn}
          onSignedIn={() => {
            setEnded(false);
            dispatchEvent(new Event(SIGNED_IN_EVENT));
          }}
        />
      ) : null}
    </>
  );
}
