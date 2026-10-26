import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { loadDatabaseUrl } from "../env.js";

const dir = new URL("./migrations/", import.meta.url);
const client = new pg.Client({ connectionString: loadDatabaseUrl() });
await client.connect();
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.name));

  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    await client.query("BEGIN");
    try {
      await client.query(await readFile(new URL(name, dir), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log(`applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
