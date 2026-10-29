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

  it("requires an Anthropic key unless OFFLINE_MODE is on", () => {
    const { ANTHROPIC_API_KEY: _, ...withoutKey } = required;
    expect(() => loadEnv(withoutKey)).toThrow(/ANTHROPIC_API_KEY is required/);
    expect(loadEnv({ ...withoutKey, OFFLINE_MODE: "true" }).OFFLINE_MODE).toBe(true);
  });
});
