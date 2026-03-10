import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotenv(): Record<string, string> {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

export default defineConfig(() => {
  const dotenv = loadDotenv();
  return {
    test: {
      root: ".",
      include: ["tests/**/*.test.ts"],
      testTimeout: 60_000,
      hookTimeout: 30_000,
      pool: "forks",
      maxWorkers: 1,
      passWithNoTests: true,
      env: dotenv,
    },
  };
});
