import { z } from "zod";

// Treat empty strings as undefined for optional env vars
const optionalString = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.url().optional(),
);

const optionalEmail = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().email().optional(),
);

export const configSchema = z.object({
  // Required — only DATABASE_URL is truly required for the app to boot
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Required for digest generation — app boots without them, fails at runtime
  ANTHROPIC_API_KEY: optionalString,
  REDDIT_CLIENT_ID: optionalString,
  REDDIT_CLIENT_SECRET: optionalString,

  // MCP server only
  MCP_SERVER_API_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32, "MCP_SERVER_API_KEY must be at least 32 characters").optional(),
  ),
  MCP_SERVER_PORT: z.coerce.number().int().min(1024).max(65535).default(3100),

  // Optional — empty strings treated as undefined
  TRIGGER_SECRET_KEY: optionalString,
  REDIS_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url("REDIS_URL must be a valid URL").optional(),
  ),
  OPENAI_API_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  SLACK_WEBHOOK_URL: optionalUrl,
  TRIGGER_API_URL: optionalUrl,
  DELIVERY_EMAIL: optionalEmail,
  TRIGGER_PROJECT_ID: optionalString,

  // Auth (BetterAuth)
  BETTER_AUTH_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters").optional(),
  ),
  BETTER_AUTH_URL: optionalUrl,
  BETTER_AUTH_TRUSTED_ORIGINS: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,

  // Defaults
  DIGEST_CRON: z.string().default("0 7 * * *"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Organization
  REDGEST_ORG_ID: optionalString,
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production" && !data.BETTER_AUTH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "BETTER_AUTH_SECRET is required in production",
      path: ["BETTER_AUTH_SECRET"],
    });
  }
});

export type RedgestConfig = z.infer<typeof configSchema>;

/** Sentinel organization ID used when auth is not yet wired (single-tenant fallback). */
export const DEFAULT_ORGANIZATION_ID = "org_default";
