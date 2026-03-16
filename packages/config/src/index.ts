import { configSchema, type RedgestConfig } from "./schema.js";

export { configSchema, type RedgestConfig, DEFAULT_ORGANIZATION_ID } from "./schema.js";

let _config: RedgestConfig | undefined;

export function loadConfig(env: Record<string, string | undefined> = process.env): RedgestConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }
  _config = result.data;
  return _config;
}

export function getConfig(): RedgestConfig {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return _config;
}

export function resetConfig(): void {
  _config = undefined;
}
