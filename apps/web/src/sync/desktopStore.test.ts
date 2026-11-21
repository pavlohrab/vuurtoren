// @vitest-environment node
import { NlpClient } from "@app/nlp-client";
import { describe, expect, it, vi } from "vitest";
import type { DesktopSync } from "../desktop/bridge.js";
import { desktopFetch, folderStore } from "./desktopStore.js";

function fakeSync(): DesktopSync & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    pickFolder: async () => "/home/me/Sync",
    list: async (root, dir) =>
      [...files.keys()]
        .filter((k) => k.startsWith(`${root}/${dir}/`))
        .map((k) => k.slice(`${root}/${dir}/`.length).split("/")[0]!),
    get: async (root, path) => files.get(`${root}/${path}`) ?? null,
    put: async (root, path, bytes) => void files.set(`${root}/${path}`, bytes),
    remove: async (root, path) => void files.delete(`${root}/${path}`),
    fetch: vi.fn(async (req) => ({
      status: req.method === "DELETE" ? 204 : 207,
      headers: { "content-type": "application/xml" },
      body: new TextEncoder().encode(`${req.method} ${req.url} ${req.headers?.["depth"] ?? ""}`),
    })),
  };
}

describe("desktop sync", () => {
  it("uses a picked folder as a sync place", async () => {
    const sync = fakeSync();
    const store = folderStore(sync, "/home/me/Sync");
    expect(store.label).toBe("Folder · Sync");
    expect(folderStore(sync, "C:\\Users\\me\\Dropbox\\").label).toBe("Folder · Dropbox");
    await store.put("vuurtoren/vault.json", new Uint8Array([1, 2]));
    expect(await store.list("vuurtoren")).toEqual(["vault.json"]);
    expect(await store.get("vuurtoren/vault.json")).toEqual(new Uint8Array([1, 2]));
    await store.remove("vuurtoren/vault.json");
    expect(await store.get("vuurtoren/vault.json")).toBeNull();
  });

  it("sends requests through the app and answers with a real Response", async () => {
    const sync = fakeSync();
    const f = desktopFetch(sync);
    const res = await f("https://dav.example.org/vuurtoren/", {
      method: "propfind",
      headers: { Depth: "1" },
      body: "<propfind/>",
    });
    expect(res.status).toBe(207);
    expect(res.headers.get("content-type")).toBe("application/xml");
    expect(await res.text()).toBe("PROPFIND https://dav.example.org/vuurtoren/ 1");
    expect(new TextDecoder().decode(vi.mocked(sync.fetch).mock.calls[0]![0].body)).toBe(
      "<propfind/>",
    );
    // No body for 204; a failure of the app reads like a failed fetch.
    expect((await f("https://x.org/a", { method: "DELETE" })).status).toBe(204);
    vi.mocked(sync.fetch).mockRejectedValueOnce(new Error("Cannot reach the sync place"));
    await expect(f("https://x.org/a")).rejects.toBeInstanceOf(TypeError);
  });

  it("asks the app once per address before the first request", async () => {
    const sync = fakeSync();
    let allow = false;
    const allowHost = vi.fn<(url: string) => Promise<void>>(() =>
      allow ? Promise.resolve() : Promise.reject(new Error("Sync was not allowed.")),
    );
    sync.allowHost = allowHost;
    const f = desktopFetch(sync);
    // Declined: nothing is sent, and the failure reads like a failed fetch.
    await expect(f("https://dav.example.org/a")).rejects.toBeInstanceOf(TypeError);
    expect(sync.fetch).not.toHaveBeenCalled();
    // Asked again later (the app keeps its own answer), then allowed once for the address.
    allow = true;
    await f("https://dav.example.org/a");
    await desktopFetch(sync)("https://dav.example.org/b", { method: "PUT", body: "x" });
    await f("https://other.example.org/a");
    expect(allowHost.mock.calls.map((c) => new URL(c[0]).host)).toEqual([
      "dav.example.org",
      "dav.example.org",
      "other.example.org",
    ]);
    expect(sync.fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps the multipart Content-Type of uploads (PDF, photo, course OCR, thumbnail)", async () => {
    const sync = fakeSync();
    vi.mocked(sync.fetch).mockImplementation(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode("{}"),
    }));
    const nlp = new NlpClient({ url: "https://home.example.org/nlp", fetch: desktopFetch(sync) });
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], "book.pdf", {
      type: "application/pdf",
    });
    const photo = new File([new Uint8Array([255, 216, 255])], "page.jpg", {
      type: "image/jpeg",
    });
    await nlp.extractPdf(pdf, "book.pdf");
    await nlp.ocr(photo, "nl", "page.jpg");
    await nlp.courseOcrStart([photo, photo]);
    await nlp.thumbnail(pdf, "book.pdf").catch(() => undefined);
    const calls = vi.mocked(sync.fetch).mock.calls.map((c) => c[0]);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/nlp/extract/pdf",
      "/nlp/ocr",
      "/nlp/course/ocr",
      "/nlp/thumbnail",
    ]);
    // What the server receives parses as a form with the files in it.
    for (const c of calls) {
      expect(c.method).toBe("POST");
      expect(c.headers?.["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
      const form = await new Request(c.url, {
        method: "POST",
        headers: c.headers ?? {},
        body: c.body as BodyInit,
      }).formData();
      const files = form.getAll("file") as File[];
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]!.size).toBeGreaterThan(0);
    }
    const course = await new Request(calls[2]!.url, {
      method: "POST",
      headers: calls[2]!.headers ?? {},
      body: calls[2]!.body as BodyInit,
    }).formData();
    expect(course.getAll("file").map((f) => (f as File).name)).toEqual(["page.jpg", "page.jpg"]);
  });

  it("forwards a Request's own headers and a JSON body unchanged", async () => {
    const sync = fakeSync();
    await desktopFetch(sync)(
      new Request("https://x.org/api", { method: "POST", headers: { "X-A": "1" }, body: "{}" }),
      { headers: { "Content-Type": "application/json", Authorization: "Bearer t" } },
    );
    const sent = vi.mocked(sync.fetch).mock.calls[0]![0];
    expect(sent.method).toBe("POST");
    expect(sent.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer t",
    });
    expect(new TextDecoder().decode(sent.body)).toBe("{}");
  });
});
