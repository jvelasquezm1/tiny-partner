import { readdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { chunkMarkdown } from "./chunk.js";
import type { Embedder } from "./embedder.js";
import type { GuidanceRepository } from "./guidance-repository.js";

const FrontMatter = z.object({ title: z.string().min(1), url: z.url() });
const GUIDANCE_DIR = new URL("../../guidance/", import.meta.url);
const MAX_GUIDE_CHARS = 200_000;

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

/** A request to add a guide failed validation; the message is for the person adding it. */
export class InvalidGuideError extends Error {}
/** The guide's file name or source URL is already in guidance/. */
export class GuideConflictError extends Error {}

const singleLine = (field: string) => z.string().trim().regex(/^[^\r\n]*$/, `${field}: una sola línea`);
const NewGuide = z.object({
  fileName: z.string().max(200),
  title: singleLine("El título").min(1, "Falta el título").max(200, "El título es demasiado largo"),
  url: z.url({ protocol: /^https?$/, error: "La URL de la fuente no es válida" }),
  source: singleLine("La fuente").max(200, "La fuente es demasiado larga").optional(),
  content: z.string().trim().min(1, "El archivo está vacío").max(MAX_GUIDE_CHARS, "El archivo es demasiado grande"),
});

/**
 * Writes a new guide into guidance/, with the same front matter as the hand-written ones. Never
 * overwrites: a taken file name or an already-cited URL is a conflict. Returns the file name.
 */
export async function addGuide(input: unknown, dir = GUIDANCE_DIR, today = new Date()): Promise<string> {
  const parsed = NewGuide.safeParse(input);
  if (!parsed.success) throw new InvalidGuideError(parsed.error.issues[0]!.message);
  const { fileName, title, url, source, content } = parsed.data;

  const file = `${slug(fileName.replace(/\.md$/i, "")) || slug(title)}.md`;
  if ((await readGuides(dir)).some(({ meta }) => meta.url === url)) {
    throw new GuideConflictError(`Ya hay una guía con la URL ${url}`);
  }
  // A front matter in the upload is replaced by the one built from the form.
  const body = content.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const frontMatter = [`title: ${title}`, `url: ${url}`, source && `source: ${source}`, `retrieved: ${today.toISOString().slice(0, 10)}`];
  try {
    await writeFile(new URL(file, dir), `---\n${frontMatter.filter(Boolean).join("\n")}\n---\n${body}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new GuideConflictError(`Ya existe guidance/${file}`);
    throw error;
  }
  return file;
}

/** Lowercase ASCII words joined by dashes: no path can come out of it. */
const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

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
