import { RedgestError } from "../errors.js";

/**
 * Parse a human-friendly duration string into milliseconds.
 * Supported formats: "30m", "48h", "7d"
 */
export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new RedgestError(
      "VALIDATION_ERROR",
      `Invalid duration: "${input}". Use <number><m|h|d>, e.g. "48h", "7d".`,
    );
  }
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 3600 * 1000;
  return value * 86400 * 1000; // days
}
