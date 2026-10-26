import { z } from "zod";

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  TYPESAFE_API_KEY: z.string().min(1),
  VOYAGE_API_KEY: z.string().min(1),
  DATABASE_URL: z.url(),
  ALLOWED_TELEGRAM_USER_IDS: z
    .string()
    .transform((ids) => new Set(ids.split(",").map((id) => Number(id.trim())).filter(Boolean))),
  TZ: z.string().default("Europe/Madrid"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}

/** Scripts that only touch the database (migrations) should not need every API key. */
export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  return z.url().parse(source.DATABASE_URL);
}
