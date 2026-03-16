import { describe, it, expect, vi } from "vitest";

const {
  MockRedditClient,
  MockPublicRedditClient,
  MockTokenBucket,
  MockRedditContentSource,
  mockRedditClientInstance,
  mockPublicRedditClientInstance,
  mockTokenBucketInstance,
} = vi.hoisted(() => {
  const mockRedditClientInstance = { authenticate: vi.fn() };
  const MockRedditClient = vi.fn(function () {
    return mockRedditClientInstance;
  });

  const mockPublicRedditClientInstance = {};
  const MockPublicRedditClient = vi.fn(function () {
    return mockPublicRedditClientInstance;
  });

  const mockTokenBucketInstance = { acquire: vi.fn() };
  const MockTokenBucket = vi.fn(function () {
    return mockTokenBucketInstance;
  });

  const MockRedditContentSource = vi.fn(function () {
    return { fetchContent: vi.fn() };
  });

  return {
    MockRedditClient,
    MockPublicRedditClient,
    MockTokenBucket,
    MockRedditContentSource,
    mockRedditClientInstance,
    mockPublicRedditClientInstance,
    mockTokenBucketInstance,
  };
});

vi.mock("../client", () => ({ RedditClient: MockRedditClient }));
vi.mock("../public-client", () => ({ PublicRedditClient: MockPublicRedditClient }));
vi.mock("../rate-limiter", () => ({ TokenBucket: MockTokenBucket }));
vi.mock("../content-source", () => ({ RedditContentSource: MockRedditContentSource }));

import { createContentSource } from "../content-source-factory";

describe("createContentSource", () => {
  it("creates authenticated client when credentials provided", () => {
    createContentSource({
      clientId: "my-id",
      clientSecret: "my-secret",
    });

    expect(MockRedditClient).toHaveBeenCalledWith({
      clientId: "my-id",
      clientSecret: "my-secret",
      userAgent: "redgest/1.0.0",
    });
    expect(MockTokenBucket).toHaveBeenCalledWith({
      capacity: 60,
      refillRate: 1,
    });
    expect(MockRedditContentSource).toHaveBeenCalledWith(
      mockRedditClientInstance,
      mockTokenBucketInstance,
    );
  });

  it("creates public client when no credentials provided", () => {
    createContentSource({});

    expect(MockPublicRedditClient).toHaveBeenCalledWith({
      userAgent: "redgest/1.0.0",
    });
    expect(MockTokenBucket).toHaveBeenCalledWith({
      capacity: 10,
      refillRate: 10 / 60,
    });
    expect(MockRedditContentSource).toHaveBeenCalledWith(
      mockPublicRedditClientInstance,
      mockTokenBucketInstance,
    );
  });

  it("allows custom userAgent", () => {
    createContentSource({
      clientId: "id",
      clientSecret: "secret",
      userAgent: "custom/2.0",
    });

    expect(MockRedditClient).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: "custom/2.0" }),
    );
  });
});
