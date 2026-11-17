import { useState } from "react";
import { Button, Dialog } from "@app/ui";
import { useAppInfo } from "../shell/AppInfo.js";

/** Settings > Account: who is signed in on this server, sign out here or everywhere. */
export function AccountSettings() {
  const { account } = useAppInfo();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      // Reload in place: the page opens on the sign-in screen at the same address.
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
      setBusy(false);
    }
  };

  return (
    <section className="stack" style={{ marginTop: 40 }} aria-labelledby="account">
      <h2 id="account" style={{ fontSize: 19 }}>
        Account
      </h2>
      {!account.authEnabled ? (
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          Sign-in is off on this server: anyone who can open this address can read and change your
          data. That is fine on your own computer. Before you make it reachable from the internet,
          set a password (see deploy/README.md).
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            {account.via === "token" || account.user === null ? (
              "Signed in with the server's access token."
            ) : (
              <>
                Signed in as <strong>{account.user}</strong>.
              </>
            )}
          </p>
          <div className="row">
            <Button onClick={() => void run(account.signOut)} disabled={busy}>
              Sign out
            </Button>
            <Button variant="ghost" onClick={() => setConfirmAll(true)} disabled={busy}>
              Sign out all devices
            </Button>
          </div>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          <Dialog
            open={confirmAll}
            onOpenChange={setConfirmAll}
            title="Sign out on every device?"
            description="Every browser that is signed in to this server, including this one, will have to sign in again. Scripts that use the access token keep working."
          >
            <div className="row">
              <Button
                variant="primary"
                onClick={() => void run(account.signOutAll)}
                disabled={busy}
              >
                Sign out everywhere
              </Button>
              <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
            </div>
          </Dialog>
        </>
      )}
    </section>
  );
}
