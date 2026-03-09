import { z } from "zod";

export const configSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  TRIGGER_SECRET_KEY: z.string().min(1, "TRIGGER_SECRET_KEY is required"),
  MCP_SERVER_API_KEY: z.string().min(32, "MCP_SERVER_API_KEY must be at least 32 characters"),
  MCP_SERVER_PORT: z.coerce.number().int().min(1024).max(65535).default(3100),
  REDDIT_CLIENT_ID: z.string().min(1, "REDDIT_CLIENT_ID is required"),
  REDDIT_CLIENT_SECRET: z.string().min(1, "REDDIT_CLIENT_SECRET is required"),

  // Optional (not needed for local dev without caching)
  REDIS_URL: z.url("REDIS_URL must be a valid URL").optional(),

  // Optional
  OPENAI_API_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  SLACK_WEBHOOK_URL: z.url().optional(),
  TRIGGER_API_URL: z.url().optional(),

  // Defaults
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type RedgestConfig = z.infer<typeof configSchema>;
