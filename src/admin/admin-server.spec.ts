import { execFileSync } from "node:child_process";
import { request as httpRequest, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncResult } from "../rag/sync-guidance.js";
import { createAdminServer, type AdminDeps } from "./admin-server.js";

const source = { title: "Sueño seguro", url: "https://www.cdc.gov/sueno", chunks: 3, ingestedAt: new Date("2026-11-10T06:00:00Z") };
const synced: SyncResult = { files: [{ file: "cdc-sueno-seguro.md", title: source.title, url: source.url, chunks: 3 }], removedChunks: 0 };

let server: Server;
afterEach(() => server?.close());

async function start(overrides: Partial<AdminDeps> = {}) {
  server = createAdminServer({
    sources: async () => [source],
    sync: async () => synced,
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, request: (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, init) };
}

describe("admin server", () => {
  it("serves the page, its assets and the indexed sources", async () => {
    const { request } = await start();
    expect(await (await request("/admin")).text()).toContain("Panel del proyecto");
    const script = await request("/admin/admin.js");
    expect(script.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(await (await request("/admin/api/sources")).json()).toEqual([{ ...source, ingestedAt: source.ingestedAt.toISOString() }]);
  });

  it("ships page scripts that parse", () => {
    // The page's JS runs only in the browser: without this, a syntax error reaches the page unnoticed.
    for (const file of ["admin.js"]) {
      expect(() => execFileSync(process.execPath, ["--check", fileURLToPath(new URL(`./public/${file}`, import.meta.url))])).not.toThrow();
    }
  });

  it("serves only the page's own files", async () => {
    const { request } = await start();
    expect((await request("/admin/..%2F..%2Fenv.ts")).status).toBe(404);
    expect((await request("/admin/admin.css", { method: "POST" })).status).toBe(404);
  });

  it("refuses a request for another host name (DNS rebinding)", async () => {
    const { port } = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      httpRequest({ port, host: "127.0.0.1", path: "/admin/api/sources", headers: { host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
        .on("error", reject)
        .end();
    });
    expect(status).toBe(403);
  });

  it("syncs on POST and returns what was ingested", async () => {
    const sync = vi.fn(async () => synced);
    const { request } = await start({ sync });
    const response = await request("/admin/api/sync", { method: "POST" });
    expect(await response.json()).toEqual(synced);
    expect(sync).toHaveBeenCalledOnce();
  });

  it("refuses a sync started from another origin", async () => {
    const sync = vi.fn(async () => synced);
    const { request } = await start({ sync });
    const response = await request("/admin/api/sync", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect(sync).not.toHaveBeenCalled();
  });

  it("refuses a second sync while one is running", async () => {
    let finish!: (result: SyncResult) => void;
    const { request } = await start({ sync: () => new Promise((resolve) => (finish = resolve)) });
    const first = request("/admin/api/sync", { method: "POST" });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect((await request("/admin/api/sync", { method: "POST" })).status).toBe(409);
    finish(synced);
    expect((await first).status).toBe(200);
  });

  it("reports a failed sync instead of crashing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { request } = await start({ sync: async () => Promise.reject(new Error("guide.md: missing front matter (title, url)")) });
    const response = await request("/admin/api/sync", { method: "POST" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "guide.md: missing front matter (title, url)" });
  });
});
