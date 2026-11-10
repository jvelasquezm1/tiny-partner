/**
 * Syncs the guidance index with guidance/*.md (see sync-guidance.ts). Runs on every deploy, before
 * the bot starts; the admin page runs the same sync on demand.
 */
import pg from "pg";
import { loadDatabaseUrl } from "../env.js";
import { Embedder } from "./embedder.js";
import { GuidanceRepository } from "./guidance-repository.js";
import { syncGuidance } from "./sync-guidance.js";

const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });

try {
  const { files, removedChunks } = await syncGuidance(new GuidanceRepository(pool), new Embedder());
  for (const { file, chunks } of files) console.log(`${file}: ${chunks} chunks`);
  if (removedChunks) console.log(`removed ${removedChunks} chunks of sources no longer in guidance/`);
} finally {
  await pool.end();
}
