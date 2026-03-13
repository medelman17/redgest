import { describe, it, expect } from "vitest";
import { parseDuration } from "../utils/duration.js";

describe("parseDuration", () => {
  it("parses minutes correctly", () => {
    expect(parseDuration("30m")).toBe(30 * 60 * 1000);
    expect(parseDuration("1m")).toBe(60 * 1000);
    expect(parseDuration("90m")).toBe(90 * 60 * 1000);
  });

  it("parses hours correctly", () => {
    expect(parseDuration("48h")).toBe(48 * 3600 * 1000);
    expect(parseDuration("1h")).toBe(3600 * 1000);
    expect(parseDuration("24h")).toBe(24 * 3600 * 1000);
  });

  it("parses days correctly", () => {
    expect(parseDuration("7d")).toBe(7 * 86400 * 1000);
    expect(parseDuration("1d")).toBe(86400 * 1000);
    expect(parseDuration("30d")).toBe(30 * 86400 * 1000);
  });

  it("throws on invalid format (no unit)", () => {
    expect(() => parseDuration("48")).toThrow('Invalid duration: "48"');
  });

  it("throws on invalid unit", () => {
    expect(() => parseDuration("7w")).toThrow('Invalid duration: "7w"');
    expect(() => parseDuration("7s")).toThrow('Invalid duration: "7s"');
  });

  it("throws on non-numeric prefix", () => {
    expect(() => parseDuration("abch")).toThrow('Invalid duration: "abch"');
  });

  it("throws on empty string", () => {
    expect(() => parseDuration("")).toThrow('Invalid duration: ""');
  });

  it("throws on just a unit letter", () => {
    expect(() => parseDuration("h")).toThrow('Invalid duration: "h"');
  });
});
