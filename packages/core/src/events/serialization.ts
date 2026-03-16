import type { DomainEvent } from "./types";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Serialize a DomainEvent to JSON string.
 * Converts Date objects to ISO 8601 strings.
 * Used by PgNotify and Redis transports.
 */
export function serializeEvent(event: DomainEvent): string {
  return JSON.stringify(event, (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    return value;
  });
}

/**
 * Deserialize a JSON string back to a DomainEvent.
 * Restores the `occurredAt` field from ISO string to Date.
 * Only coerces values that match ISO 8601 format to avoid false positives.
 */
export function deserializeEvent(json: string): DomainEvent {
  return JSON.parse(json, (key, value) => {
    if (
      key === "occurredAt" &&
      typeof value === "string" &&
      ISO_DATE_REGEX.test(value)
    ) {
      return new Date(value);
    }
    return value;
  }) as DomainEvent;
}
