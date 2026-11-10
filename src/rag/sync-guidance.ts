import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { chunkMarkdown } from "./chunk.js";
import type { Embedder } from "./embedder.js";
import type { GuidanceRepository } from "./guidance-repository.js";

const FrontMatter = z.object({ title: z.string().min(1), url: z.url() });
const GUIDANCE_DIR = new URL("../../guidance/", import.meta.url);

export interface SyncedFile {
  file: string;
  title: string;
  url: string;
  chunks: number;
}

export interface SyncResult {
  files: SyncedFile[];
  /** Chunks of sources whose file is no longer in guidance/. */
  removedChunks: number;
}

/**
 * Ingests every guidance/*.md file. Each file starts with front matter naming its source:
 *
 *   ---
 *   title: Breastfeeding: the first few days
 *   url: https://example.org/breastfeeding-first-days
 *   ---
 *
 * Only add content whose license allows reuse, and keep the url pointing at the original.
 *
 * guidance/ is the source of truth and the table is an index rebuilt from it: sources whose file
 * is gone are deleted.
 */
export async function syncGuidance(guidance: GuidanceRepository, embedder: Embedder, dir = GUIDANCE_DIR): Promise<SyncResult> {
  const files: SyncedFile[] = [];
  // Every file is parsed before any is ingested: a broken one fails the sync with the index untouched.
  for (const { file, meta, body } of await readGuides(dir)) {
    const chunks = chunkMarkdown(body);
    const embeddings = await embedder.embedDocuments(chunks);
    await guidance.replaceSource(meta.title, meta.url, chunks.map((content, i) => ({ content, embedding: embeddings[i]! })));
    files.push({ file, title: meta.title, url: meta.url, chunks: chunks.length });
  }
  // Only reached when every file ingested: a failure above leaves the previous index intact.
  const removedChunks = await guidance.deleteSourcesExcept(files.map(({ url }) => url));
  return { files, removedChunks };
}

async function readGuides(dir: URL) {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".md") && name !== "README.md");
  return Promise.all(files.map(async (file) => ({ file, ...parse(await readFile(new URL(file, dir), "utf8"), file) })));
}

function parse(raw: string, file: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing front matter (title, url)`);
  const fields = Object.fromEntries(
    match[1]!.split("\n").map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
  );
  return { meta: FrontMatter.parse(fields), body: match[2]! };
}
