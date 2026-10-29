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
 * is gone are deleted. Runs on every deploy, before the bot starts.
 */
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { z } from "zod";
import { chunkMarkdown } from "./chunk.js";
import { Embedder } from "./embedder.js";
import { GuidanceRepository } from "./guidance-repository.js";

const FrontMatter = z.object({ title: z.string().min(1), url: z.url() });

const env = z.object({ DATABASE_URL: z.url() }).parse(process.env);
const dir = new URL("../../guidance/", import.meta.url);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const embedder = new Embedder();
const guidance = new GuidanceRepository(pool);

try {
  const ingestedUrls: string[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".md") && name !== "README.md")) {
    const { meta, body } = parse(await readFile(new URL(file, dir), "utf8"), file);
    const chunks = chunkMarkdown(body);
    const embeddings = await embedder.embedDocuments(chunks);
    await guidance.replaceSource(meta.title, meta.url, chunks.map((content, i) => ({ content, embedding: embeddings[i]! })));
    console.log(`${file}: ${chunks.length} chunks`);
    ingestedUrls.push(meta.url);
  }
  // Only reached when every file ingested: a failure above leaves the previous index intact.
  const removed = await guidance.deleteSourcesExcept(ingestedUrls);
  if (removed) console.log(`removed ${removed} chunks of sources no longer in guidance/`);
} finally {
  await pool.end();
}

function parse(raw: string, file: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing front matter (title, url)`);
  const fields = Object.fromEntries(
    match[1]!.split("\n").map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
  );
  return { meta: FrontMatter.parse(fields), body: match[2]! };
}
