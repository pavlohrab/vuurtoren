import { describe, expect, it, vi } from "vitest";
import { qrPath } from "../screens/settings/QrCode.js";
import {
  connectLink,
  pairWithServer,
  pairedLabel,
  pairingCode,
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
