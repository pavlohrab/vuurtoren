import { describe, expect, it, vi } from "vitest";
import { qrPath } from "../screens/settings/QrCode.js";
import {
  connectLink,
  lanLink,
  pairedLabel,
  pairingCode,
  pairWithServer,
  parseConnectLink,
  serverAddress,
} from "./connect.js";

describe("vuurtoren://connect links", () => {
  it("round-trips the server's link and reads both spellings of the scheme", () => {
    const link = connectLink("https://vuurtoren.example.org/vt", "ABCDE-FGHJK");
    expect(link).toBe(
      "vuurtoren://connect?server=https%3A%2F%2Fvuurtoren.example.org%2Fvt&code=ABCDE-FGHJK",
    );
    expect(parseConnectLink(link)).toEqual({
      server: "https://vuurtoren.example.org/vt",
      code: "ABCDE-FGHJK",
    });
    expect(
      parseConnectLink("  vuurtoren:connect?server=http://192.168.1.4:8080/&code=abcdefghjk "),
    ).toEqual({ server: "http://192.168.1.4:8080", code: "ABCDE-FGHJK" });
  });

  it("refuses what is not a connect link", () => {
    expect(parseConnectLink("https://vuurtoren.example.org")).toBeNull();
    expect(
      parseConnectLink("vuurtoren://open?server=https://a.example&code=ABCDE-FGHJK"),
    ).toBeNull();
    expect(parseConnectLink("vuurtoren://connect?server=https://a.example")).toBeNull();
    expect(
      parseConnectLink("vuurtoren://connect?server=ftp://a.example&code=ABCDE-FGHJK"),
    ).toBeNull();
    expect(parseConnectLink("vuurtoren://connect?server=https://a.example&code=ABC")).toBeNull();
    // 0, 1, I, L and O are never in a code.
    expect(
      parseConnectLink("vuurtoren://connect?server=https://a.example&code=OOOOO-11111"),
    ).toBeNull();
    expect(parseConnectLink("not a link")).toBeNull();
  });

  it("reads typed addresses and codes", () => {
    expect(serverAddress("vuurtoren.example.org/")).toBe("https://vuurtoren.example.org");
    expect(serverAddress("http://nas.local:8080")).toBe("http://nas.local:8080");
    expect(serverAddress("https://user:pw@a.example")).toBeNull();
    expect(serverAddress("")).toBeNull();
    expect(pairingCode("abcde fghjk")).toBe("ABCDE-FGHJK");
    expect(pairingCode("ABCDE-FGHJ")).toBeNull();
  });

  it("names a phone by its model", () => {
    const pixel = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit";
    expect(pairedLabel("Phone", pixel, true)).toBe("Phone (Pixel 8)");
    expect(pairedLabel("Phone", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit", true)).toBe(
      "Phone",
    );
    expect(pairedLabel("Anna's phone", "Mozilla/5.0 (Linux; Android 10; K)", true)).toBe(
      "Phone (Anna's phone)",
    );
    expect(pairedLabel("Laptop", pixel, false)).toBe("Laptop");
  });

  it("encodes the link as a QR code", () => {
    const { size, d } = qrPath(connectLink("https://vuurtoren.example.org", "ABCDE-FGHJK"));
    // Version 5 at level M holds 84 bytes: 21 + 4 * (5 - 1) modules a side.
    expect(size).toBeGreaterThanOrEqual(29);
    expect(d.length).toBeGreaterThan(100);
  });
});

describe("pairing with a server", () => {
  const link = { server: "https://vuurtoren.example", code: "ABCDE-FGHJK" };

  it("sends the code and the device's name, and returns the token", async () => {
    const fetch = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ ok: true, token: "ksync_x", id: "a1", label: "Phone (Pixel 8)" }),
    );
    const paired = await pairWithServer(link, "Phone (Pixel 8)", fetch as typeof globalThis.fetch);
    expect(paired).toEqual({
      url: "https://vuurtoren.example",
      token: "ksync_x",
      label: "Phone (Pixel 8)",
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://vuurtoren.example/api/sync/pair");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      code: "ABCDE-FGHJK",
      name: "Phone (Pixel 8)",
    });
  });

  it("signs in with the server's user name and password instead of a code", async () => {
    const fetch = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ ok: true, token: "ksync_y", id: "a2", label: "Desktop" }),
    );
    const signIn = { server: "https://vuurtoren.example", user: "anna", password: "s3cret" };
    const paired = await pairWithServer(signIn, "Desktop", fetch as typeof globalThis.fetch);
    expect(paired.token).toBe("ksync_y");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      user: "anna",
      password: "s3cret",
      name: "Desktop",
    });
  });

  it("says why it did not work", async () => {
    const answer = (status: number, body: object) =>
      (async () => Response.json(body, { status })) as unknown as typeof globalThis.fetch;
    await expect(
      pairWithServer(link, "Phone", answer(403, { error: "This pairing code does not work." })),
    ).rejects.toThrow("This pairing code does not work.");
    await expect(pairWithServer(link, "Phone", answer(404, {}))).rejects.toThrow(
      /does not answer like a Vuurtoren server/,
    );
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    await expect(pairWithServer(link, "Phone", offline)).rejects.toThrow(/cannot be reached/);
  });
});

describe("the link a computer shows for its phone", () => {
  const cert = "ab".repeat(32);
  it("carries the home-network address, the certificate and the code, and reads back", () => {
    const link = lanLink("192.168.1.20", 47120, cert, "ABCDE-FGHJK");
    expect(parseConnectLink(link)).toEqual({
      server: "https://192.168.1.20:47120",
      code: "ABCDE-FGHJK",
      pinned: cert,
    });
  });

  it("refuses a link without a whole certificate or a port", () => {
    expect(parseConnectLink(lanLink("192.168.1.20", 47120, "abc", "ABCDE-FGHJK"))).toBeNull();
    expect(
      parseConnectLink(`vuurtoren://connect?lan=192.168.1.20&cert=${cert}&code=ABCDE-FGHJK`),
    ).toBeNull();
  });
});

describe("pairing with your computer waits for its yes (SY12)", () => {
  const link = { server: "https://192.168.1.20:47120", code: "ABCDE-FGHJK", pinned: "ab" };
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status });
  const noWait = async () => undefined;

  it("asks again until the computer says yes, then gets the token and the key", async () => {
    const answers = [
      reply(202, { waiting: "w1" }),
      reply(202, { waiting: "w1" }),
      reply(200, { token: "t1", label: "Pixel", handover: { key: "S0VZ" } }),
    ];
    const fetch = vi.fn(async (url: string) => (void url, answers.shift()!));
    const onWait = vi.fn();
    const paired = await pairWithServer(
      link,
      "Pixel",
      fetch as unknown as typeof globalThis.fetch,
      onWait,
      noWait,
    );
    expect(onWait).toHaveBeenCalledOnce();
    expect(paired).toMatchObject({ token: "t1", key: "S0VZ" });
    expect(fetch.mock.calls[1]![0]).toBe("https://192.168.1.20:47120/api/sync/pair/wait");
  });

  it("says so when the computer says no", async () => {
    const answers = [
      reply(202, { waiting: "w1" }),
      reply(403, { error: "Your computer said no. Show a new code on it and scan it again." }),
    ];
    const fetch = vi.fn(async () => answers.shift()!);
    await expect(
      pairWithServer(link, "Pixel", fetch as unknown as typeof globalThis.fetch, undefined, noWait),
    ).rejects.toThrow(/said no/);
  });
});

describe("the typed code (SY9)", () => {
  it("knows the user's computer by its home address, with the phone port unless typed", async () => {
    const { typedComputer } = await import("./connect.js");
    expect(typedComputer("https://192.168.178.123")).toBe("https://192.168.178.123:47120");
    expect(typedComputer("https://10.0.0.5:5000")).toBe("https://10.0.0.5:5000");
    expect(typedComputer("https://vuurtoren.example.org")).toBeNull();
    expect(typedComputer("https://8.8.8.8")).toBeNull();
  });

  it("trusts the certificate only when the computer's proof matches it", async () => {
    const { createHmac } = await import("node:crypto");
    const { proveComputer } = await import("./connect.js");
    const code = "ABCDE-FGHJK";
    // The real computer: the proof is made with the code and its own certificate.
    const honest = async (_base: string, nonce: string) => ({
      fingerprint: "ab12",
      proof: createHmac("sha256", "ABCDEFGHJK")
        .update(`vuurtoren-pair:${nonce}:ab12`)
        .digest("hex"),
    });
    await expect(proveComputer("https://192.168.1.20:47120", code, honest)).resolves.toBe("ab12");
    // Someone in between relays the real proof but shows their own certificate.
    const between = async (base: string, nonce: string) => ({
      ...(await honest(base, nonce)),
      fingerprint: "cd34",
    });
    await expect(proveComputer("https://192.168.1.20:47120", code, between)).rejects.toThrow(
      /not the computer that shows this code/,
    );
  });
});
