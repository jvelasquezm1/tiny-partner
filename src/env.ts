import { z } from "zod";

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  // Keyword rules instead of model calls, to try the bot without an API key (see offline.ts).
  OFFLINE_MODE: z.stringbool().default(false),
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((key) => key || undefined),
  // Optional: without it the bot runs on Claude alone (see main.ts).
  TYPESAFE_API_KEY: z
    .string()
    .optional()
    .transform((key) => key || undefined),
  DATABASE_URL: z.url(),
  ALLOWED_TELEGRAM_USER_IDS: z
    .string()
    .transform((ids) => new Set(ids.split(",").map((id) => Number(id.trim())).filter(Boolean))),
  TZ: z.string().default("Europe/Madrid"),
}).refine((env) => env.OFFLINE_MODE || env.ANTHROPIC_API_KEY, {
  message: "ANTHROPIC_API_KEY is required unless OFFLINE_MODE=true",
  path: ["ANTHROPIC_API_KEY"],
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}

/** Scripts that only touch the database (migrations) should not need every API key. */
export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  return z.url().parse(source.DATABASE_URL);
}
