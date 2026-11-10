import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { GuidanceSource } from "../rag/guidance-repository.js";
import { GuideConflictError, InvalidGuideError, type SyncResult } from "../rag/sync-guidance.js";
import { InvalidRangeError, type RangeQuery, type Stats } from "./stats-repository.js";

export interface AdminDeps {
  sources: () => Promise<GuidanceSource[]>;
  stats: (query: RangeQuery) => Promise<Stats>;
  sync: () => Promise<SyncResult>;
  /** Writes the uploaded guide into guidance/ and returns its file name (see addGuide). */
  addGuide: (input: unknown) => Promise<string>;
}

/** Guides are a few KB; this leaves room for long ones plus the JSON around them. */
const MAX_BODY_BYTES = 1_000_000;

const PUBLIC_DIR = new URL("./public/", import.meta.url);
/** The page's files: a fixed list, so no path can reach any other file. Read per request, so edits show on reload. */
const ASSETS: Record<string, { file: string; type: string }> = {
  "/admin": { file: "index.html", type: "text/html; charset=utf-8" },
  "/admin/admin.css": { file: "admin.css", type: "text/css; charset=utf-8" },
  "/admin/admin.js": { file: "admin.js", type: "text/javascript; charset=utf-8" },
  "/admin/charts.js": { file: "charts.js", type: "text/javascript; charset=utf-8" },
};

/**
 * The admin page: project stats, the indexed guidance, adding a guide, and a re-sync of the index with guidance/.
 * No login yet, so it only answers on localhost: a request for another host name (DNS rebinding)
 * is refused, and so is a POST from another origin, so a page elsewhere cannot write or sync.
 */
export function createAdminServer(deps: AdminDeps): Server {
  let syncing = false;

  return createServer(async (req, res) => {
    try {
      if (!forLocalhost(req)) return json(res, 403, { error: "localhost only" });
      const { pathname: path, searchParams } = new URL(req.url ?? "/", "http://admin");
      const route = `${req.method} ${path}`;
      if (route === "GET /") return send(res, 302, "text/plain", "", { Location: "/admin" });
      const asset = req.method === "GET" ? ASSETS[path] : undefined;
      if (asset) return send(res, 200, asset.type, await readFile(new URL(asset.file, PUBLIC_DIR), "utf8"));
      if (route === "GET /admin/api/sources") return json(res, 200, await deps.sources());
      if (route === "GET /admin/api/stats") {
        const query = { days: searchParams.get("days"), from: searchParams.get("from"), to: searchParams.get("to") };
        return json(res, 200, await deps.stats(query));
      }
      if (route === "POST /admin/api/sync" || route === "POST /admin/api/guides") {
        if (!sameOrigin(req)) return json(res, 403, { error: "cross-origin request" });
        // One write at a time: adding a guide re-syncs too, so it holds the same lock.
        if (syncing) return json(res, 409, { error: "Ya hay una reindexación en curso" });
        syncing = true;
        try {
          if (route === "POST /admin/api/sync") return json(res, 200, await deps.sync());
          const file = await deps.addGuide(await readJson(req));
          return json(res, 200, { file, ...(await deps.sync()) });
        } finally {
          syncing = false;
        }
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof InvalidGuideError || error instanceof InvalidRangeError) return json(res, 400, { error: error.message });
      if (error instanceof GuideConflictError) return json(res, 409, { error: error.message });
      console.error("admin request failed", error);
      return json(res, 500, { error: error instanceof Error ? error.message : "unexpected error" });
    }
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new InvalidGuideError("El archivo es demasiado grande");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidGuideError("La petición no es JSON válido");
  }
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function forLocalhost(req: IncomingMessage): boolean {
  return LOCAL_HOSTNAMES.has(URL.parse(`http://${req.headers.host}`)?.hostname ?? "");
}

/** Browsers send Origin on every POST; curl sends none. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return !origin || URL.parse(origin)?.host === req.headers.host;
}

function json(res: ServerResponse, status: number, body: unknown) {
  send(res, status, "application/json", JSON.stringify(body));
}

function send(res: ServerResponse, status: number, contentType: string, body: string, headers: Record<string, string> = {}) {
  res
    .writeHead(status, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      // No inline script or style anywhere on the page, so it can be this strict.
      "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    })
    .end(body);
}
