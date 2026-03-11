import { describe, it, expect, beforeEach } from "vitest";
import { configSchema } from "../schema.js";
import { loadConfig, getConfig, resetConfig } from "../index.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/redgest",
  ANTHROPIC_API_KEY: "sk-ant-test-key-1234567890",
  MCP_SERVER_API_KEY: "mcp-test-api-key-that-is-at-least-32-chars-long",
  MCP_SERVER_PORT: "3100",
  NODE_ENV: "development",
  REDDIT_CLIENT_ID: "test-client-id",
  REDDIT_CLIENT_SECRET: "test-client-secret",
};

describe("configSchema", () => {
  it("parses a valid full configuration", () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DATABASE_URL).toBe(validEnv.DATABASE_URL);
      expect(result.data.MCP_SERVER_PORT).toBe(3100);
      expect(result.data.NODE_ENV).toBe("development");
    }
  });

  it("applies default values", () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LOG_LEVEL).toBe("info");
      expect(result.data.MCP_SERVER_PORT).toBe(3100);
    }
  });

  it("fails when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _db, ...env } = validEnv;
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("accepts missing ANTHROPIC_API_KEY (optional for web UI)", () => {
    const { ANTHROPIC_API_KEY: _key, ...env } = validEnv;
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ANTHROPIC_API_KEY).toBeUndefined();
    }
  });

  it("fails when MCP_SERVER_API_KEY is present but too short", () => {
    const result = configSchema.safeParse({
      ...validEnv,
      MCP_SERVER_API_KEY: "short",
    });
    expect(result.success).toBe(false);
  });

  it("accepts missing MCP_SERVER_API_KEY (optional for web UI)", () => {
    const { MCP_SERVER_API_KEY: _key, ...env } = validEnv;
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_SERVER_API_KEY).toBeUndefined();
    }
  });

  it("fails when NODE_ENV is invalid", () => {
    const result = configSchema.safeParse({
      ...validEnv,
      NODE_ENV: "staging",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields when missing", () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OPENAI_API_KEY).toBeUndefined();
      expect(result.data.RESEND_API_KEY).toBeUndefined();
      expect(result.data.SLACK_WEBHOOK_URL).toBeUndefined();
      expect(result.data.REDIS_URL).toBeUndefined();
      expect(result.data.TRIGGER_SECRET_KEY).toBeUndefined();
      expect(result.data.DELIVERY_EMAIL).toBeUndefined();
    }
  });

  it("accepts TRIGGER_SECRET_KEY when provided", () => {
    const result = configSchema.safeParse({
      ...validEnv,
      TRIGGER_SECRET_KEY: "tr_dev_test_key_1234567890",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TRIGGER_SECRET_KEY).toBe("tr_dev_test_key_1234567890");
    }
  });

  it("accepts a valid DELIVERY_EMAIL", () => {
    const result = configSchema.safeParse({
      ...validEnv,
      DELIVERY_EMAIL: "user@example.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DELIVERY_EMAIL).toBe("user@example.com");
    }
  });

  it("fails when DELIVERY_EMAIL is not a valid email", () => {
    const result = configSchema.safeParse({
      ...validEnv,
      DELIVERY_EMAIL: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("applies default DIGEST_CRON value", () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DIGEST_CRON).toBe("0 7 * * *");
    }
  });

  it("accepts a custom DIGEST_CRON value", () => {
    const result = configSchema.safeParse({
      ...validEnv,
      DIGEST_CRON: "0 9 * * 1-5",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DIGEST_CRON).toBe("0 9 * * 1-5");
    }
  });

  it("coerces MCP_SERVER_PORT string to number", () => {
    const result = configSchema.safeParse({
      ...validEnv,
      MCP_SERVER_PORT: "8080",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_SERVER_PORT).toBe(8080);
    }
  });

  it("accepts missing Reddit credentials (optional for web UI)", () => {
    const { REDDIT_CLIENT_ID: _id, REDDIT_CLIENT_SECRET: _secret, ...env } = validEnv;
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.REDDIT_CLIENT_ID).toBeUndefined();
      expect(result.data.REDDIT_CLIENT_SECRET).toBeUndefined();
    }
  });

  it("parses valid Reddit credentials", () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.REDDIT_CLIENT_ID).toBe("test-client-id");
      expect(result.data.REDDIT_CLIENT_SECRET).toBe("test-client-secret");
    }
  });
});

describe("loadConfig", () => {
  beforeEach(() => resetConfig());

  it("loads and returns parsed config", () => {
    const config = loadConfig(validEnv);
    expect(config.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("throws on invalid config with descriptive message", () => {
    expect(() => loadConfig({})).toThrow("Configuration validation failed");
  });
});

describe("getConfig", () => {
  beforeEach(() => resetConfig());

  it("throws before loadConfig is called", () => {
    expect(() => getConfig()).toThrow("Config not loaded");
  });

  it("returns config after loadConfig is called", () => {
    loadConfig(validEnv);
    const config = getConfig();
    expect(config.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });
});
