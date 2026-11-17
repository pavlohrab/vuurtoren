import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "../shell/SessionGate.js";
import { SignInScreen } from "../shell/SignIn.js";
import { createAuthClient, type Credentials, type SignInResult } from "./client.js";
import { installFetchWatch, SIGNED_IN_EVENT, watchesUrl } from "./watch.js";

const ORIGIN = "https://kenning.example.com";

function signInMock(...results: SignInResult[]) {
  const calls: Credentials[] = [];
  const fn = vi.fn((c: Credentials) => {
    calls.push(c);
    return Promise.resolve(results.shift() ?? { ok: true as const, user: "anna" });
  });
  return { fn, calls };
}

describe("sign-in screen", () => {
  afterEach(() => vi.useRealTimers());

  it("is ready for password managers and the keyboard", async () => {
    const { fn, calls } = signInMock({ ok: true, user: "anna" });
    const done = vi.fn();
    render(<SignInScreen methods={["password"]} signIn={fn} onSignedIn={done} />);
    const user = screen.getByLabelText("Username");
    const pass = screen.getByLabelText("Password");
    expect(user).toHaveAttribute("autocomplete", "username");
    expect(user).toHaveAttribute("name", "username");
    expect(pass).toHaveAttribute("autocomplete", "current-password");
    expect(pass).toHaveAttribute("type", "password");
    expect(user).toHaveFocus();

    await userEvent.type(user, "anna");
    await userEvent.type(pass, "geheim{Enter}"); // Enter submits
    await waitFor(() => expect(done).toHaveBeenCalledWith("anna"));
    expect(calls).toEqual([{ user: "anna", password: "geheim" }]);
  });

  it("shows and hides the password with a real toggle button", async () => {
    render(<SignInScreen methods={["password"]} signIn={signInMock().fn} onSignedIn={() => {}} />);
    const pass = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(pass).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("explains a wrong password and keeps the username", async () => {
    const { fn } = signInMock({
      ok: false,
      kind: "invalid",
      message: "Wrong username or password.",
    });
    const done = vi.fn();
    render(<SignInScreen methods={["password"]} signIn={fn} onSignedIn={done} />);
    await userEvent.type(screen.getByLabelText("Username"), "anna");
    await userEvent.type(screen.getByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    expect(screen.getByLabelText("Username")).toHaveValue("anna");
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(done).not.toHaveBeenCalled();
  });

  it("asks for missing fields without calling the server", async () => {
    const { fn } = signInMock();
    render(<SignInScreen methods={["password"]} signIn={fn} onSignedIn={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your username.");
    expect(fn).not.toHaveBeenCalled();
  });

  it("waits out a rate limit with a countdown, then allows another try", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fn } = signInMock({ ok: false, kind: "rate-limited", message: "x", retryAfter: 3 });
    render(<SignInScreen methods={["password"]} signIn={fn} onSignedIn={() => {}} />);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await u.type(screen.getByLabelText("Username"), "anna");
    await u.type(screen.getByLabelText("Password"), "nope{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. You can try again in 0:03.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("offers the access token when the server has only a token", async () => {
    const { fn, calls } = signInMock();
    render(<SignInScreen methods={["token"]} signIn={fn} onSignedIn={() => {}} />);
    expect(screen.queryByLabelText("Username")).toBeNull();
    await userEvent.type(screen.getByLabelText("Access token"), "t0ken{Enter}");
    await waitFor(() => expect(calls).toEqual([{ token: "t0ken" }]));
  });
});

describe("auth client", () => {
  const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    vi.fn(() =>
      Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), { status, headers }),
      ),
    );

  it("sends JSON with the CSRF header and reads the answers", async () => {
    const f = reply(200, { ok: true, user: "anna" });
    const c = createAuthClient("", f as unknown as typeof fetch);
    expect(await c.signIn({ user: "anna", password: "pw" })).toEqual({ ok: true, user: "anna" });
    const init = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe("/api/auth/login");
    expect(init[1].headers).toMatchObject({ "content-type": "application/json", "x-kenning": "1" });
    expect(init[1].credentials).toBe("same-origin");
  });

  it("maps 401, 429 and outages", async () => {
    const bad = createAuthClient("", reply(401) as unknown as typeof fetch);
    expect(await bad.signIn({ user: "a", password: "b" })).toMatchObject({ kind: "invalid" });
    const slow = createAuthClient(
      "",
      reply(429, {}, { "retry-after": "42" }) as unknown as typeof fetch,
    );
    expect(await slow.signIn({ user: "a", password: "b" })).toMatchObject({
      kind: "rate-limited",
      retryAfter: 42,
    });
    const down = createAuthClient("", (() => Promise.reject(new TypeError("net"))) as typeof fetch);
    expect(await down.signIn({ user: "a", password: "b" })).toMatchObject({ kind: "unavailable" });
    expect(await createAuthClient("", reply(401) as unknown as typeof fetch).me()).toBeNull();
    await expect(
      createAuthClient("", reply(502) as unknown as typeof fetch).me(),
    ).rejects.toThrow();
  });
});

describe("session watch", () => {
  it("only watches same-origin /api and /nlp, not the sign-in endpoints or other sites", () => {
    expect(watchesUrl("/api/rpc", ORIGIN)).toBe(true);
    expect(watchesUrl(`${ORIGIN}/nlp/analyze/text`, ORIGIN)).toBe(true);
    expect(watchesUrl(new URL("/api/export", ORIGIN), ORIGIN)).toBe(true);
    expect(watchesUrl("/api/auth/login", ORIGIN)).toBe(false);
    expect(watchesUrl("/api/health", ORIGIN)).toBe(false);
    expect(watchesUrl("http://127.0.0.1:8765/", ORIGIN)).toBe(false); // AnkiConnect
    expect(watchesUrl("https://api.anthropic.com/v1/messages", ORIGIN)).toBe(false);
  });

  it("a 401 lays sign-in over the app (which stays mounted) and refetches after", async () => {
    let status = 200;
    const target = {
      fetch: (() => Promise.resolve(new Response("{}", { status }))) as typeof fetch,
    };
    const restore = installFetchWatch(target, ORIGIN);
    const refetched = vi.fn();
    addEventListener(SIGNED_IN_EVENT, refetched);
    const { fn } = signInMock({ ok: true, user: "anna" });
    try {
      render(
        <SessionGate methods={["password"]} user="anna" signIn={fn}>
          <p>Reading page 3 of Een dag in Utrecht</p>
        </SessionGate>,
      );
      await act(() => target.fetch("/api/rpc"));
      expect(screen.queryByRole("heading", { name: "Sign in again" })).toBeNull();

      status = 401;
      await act(() => target.fetch(`${ORIGIN}/nlp/analyze/text`));
      expect(await screen.findByRole("heading", { name: "Sign in again" })).toBeInTheDocument();
      // the page underneath is still there (route and input kept), but inert
      const page = screen.getByText("Reading page 3 of Een dag in Utrecht", { selector: "p" });
      expect(page.parentElement).toHaveAttribute("inert");
      // username is prefilled, so the password has focus
      expect(screen.getByLabelText("Username")).toHaveValue("anna");
      expect(screen.getByLabelText("Password")).toHaveFocus();

      await userEvent.type(screen.getByLabelText("Password"), "geheim{Enter}");
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: "Sign in again" })).toBeNull(),
      );
      expect(refetched).toHaveBeenCalledTimes(1);
      expect(page.parentElement).not.toHaveAttribute("inert");
    } finally {
      removeEventListener(SIGNED_IN_EVENT, refetched);
      restore();
    }
  });
});
