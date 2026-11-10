import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const required = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  ANTHROPIC_API_KEY: "sk-test",
  DATABASE_URL: "postgres://tiny:tiny@localhost:5544/tiny_partner",
  ALLOWED_TELEGRAM_USER_IDS: "1, 2",
};

describe("loadEnv", () => {
  it("treats a missing or empty TypeSafe key as no Jev", () => {
    expect(loadEnv(required).TYPESAFE_API_KEY).toBeUndefined();
    expect(loadEnv({ ...required, TYPESAFE_API_KEY: "" }).TYPESAFE_API_KEY).toBeUndefined();
  });

  it("keeps a configured TypeSafe key", () => {
    expect(loadEnv({ ...required, TYPESAFE_API_KEY: "ts-test" }).TYPESAFE_API_KEY).toBe("ts-test");
  });

  it("defaults the admin page's port", () => {
    expect(loadEnv(required).ADMIN_PORT).toBe(4100);
    expect(loadEnv({ ...required, ADMIN_PORT: "4200" }).ADMIN_PORT).toBe(4200);
  });

  it("requires an Anthropic or Gemini key unless OFFLINE_MODE is on", () => {
    const { ANTHROPIC_API_KEY: _, ...withoutKey } = required;
    expect(() => loadEnv(withoutKey)).toThrow(/ANTHROPIC_API_KEY or GEMINI_API_KEY is required/);
    expect(loadEnv({ ...withoutKey, GEMINI_API_KEY: "gm-test" }).GEMINI_API_KEY).toBe("gm-test");
    expect(loadEnv({ ...withoutKey, OFFLINE_MODE: "true" }).OFFLINE_MODE).toBe(true);
  });
});
