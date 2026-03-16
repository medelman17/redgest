import { describe, it, expect } from "vitest";
import {
  buildDeliveryData,
  buildFormattedDigest,
  type DigestWithRelations,
} from "../transform";
import type { DigestDeliveryData } from "../types";

function makeDigestWithRelations(
  overrides?: Partial<DigestWithRelations>,
): DigestWithRelations {
  return {
    id: "digest-001",
    createdAt: new Date("2026-03-10T12:00:00Z"),
    digestPosts: [
      {
        rank: 1,
        subreddit: "typescript",
        post: {
          title: "TS 6.0 Released",
          permalink: "/r/typescript/comments/abc/ts-60",
          score: 250,
          summaries: [
            {
              summary: "TypeScript 6.0 adds new features.",
              keyTakeaways: JSON.stringify(["Better types", "Faster compiler"]),
              insightNotes: "Major release",
              commentHighlights: JSON.stringify([
                { author: "dev1", insight: "Great update", score: 50 },
              ]),
            },
          ],
        },
      },
      {
        rank: 2,
        subreddit: "typescript",
        post: {
          title: "TS Tips",
          permalink: "/r/typescript/comments/def/tips",
          score: 100,
          summaries: [
            {
              summary: "Helpful tips for TS.",
              keyTakeaways: JSON.stringify(["Use strict"]),
              insightNotes: "",
              commentHighlights: JSON.stringify([]),
            },
          ],
        },
      },
      {
        rank: 3,
        subreddit: "rust",
        post: {
          title: "Rust 2026",
          permalink: "/r/rust/comments/ghi/rust-2026",
          score: 300,
          summaries: [
            {
              summary: "Rust edition 2026.",
              keyTakeaways: JSON.stringify([]),
              insightNotes: "Edition release",
              commentHighlights: JSON.stringify([]),
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe("buildDeliveryData", () => {
  it("transforms digest with relations into DigestDeliveryData", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    expect(result.digestId).toBe("digest-001");
    expect(result.createdAt).toEqual(new Date("2026-03-10T12:00:00Z"));
    expect(result.subreddits).toHaveLength(2);
  });

  it("groups posts by subreddit", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    const ts = result.subreddits.find((s) => s.name === "typescript");
    expect(ts).toBeDefined();
    if (!ts) return;
    expect(ts.posts).toHaveLength(2);

    const rust = result.subreddits.find((s) => s.name === "rust");
    expect(rust).toBeDefined();
    if (!rust) return;
    expect(rust.posts).toHaveLength(1);
  });

  it("parses JSON fields from summaries", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    const ts = result.subreddits.find((s) => s.name === "typescript");
    expect(ts).toBeDefined();
    if (!ts) return;
    const firstPost = ts.posts[0];
    expect(firstPost).toBeDefined();
    if (!firstPost) return;
    expect(firstPost.keyTakeaways).toEqual(["Better types", "Faster compiler"]);
    expect(firstPost.commentHighlights).toEqual([
      { author: "dev1", insight: "Great update", score: 50 },
    ]);
  });

  it("skips posts without summaries", () => {
    const input = makeDigestWithRelations({
      digestPosts: [
        {
          rank: 1,
          subreddit: "typescript",
          post: {
            title: "No Summary",
            permalink: "/r/typescript/comments/xyz/no-summary",
            score: 10,
            summaries: [],
          },
        },
      ],
    });
    const result = buildDeliveryData(input);

    expect(result.subreddits).toHaveLength(0);
  });

  it("handles empty digestPosts", () => {
    const input = makeDigestWithRelations({ digestPosts: [] });
    const result = buildDeliveryData(input);

    expect(result.subreddits).toHaveLength(0);
  });

  it("handles already-parsed JSON fields (Prisma/pg runtime behavior)", () => {
    const input = makeDigestWithRelations({
      digestPosts: [
        {
          rank: 1,
          subreddit: "typescript",
          post: {
            title: "Parsed JSON",
            permalink: "/r/typescript/comments/abc/parsed",
            score: 200,
            summaries: [
              {
                summary: "Already parsed.",
                keyTakeaways: ["takeaway1", "takeaway2"],
                insightNotes: "notes",
                commentHighlights: [
                  { author: "dev1", insight: "Great", score: 10 },
                ],
              },
            ],
          },
        },
      ],
    });
    const result = buildDeliveryData(input);

    const ts = result.subreddits.find((s) => s.name === "typescript");
    expect(ts).toBeDefined();
    if (!ts) return;
    const post = ts.posts[0];
    expect(post).toBeDefined();
    if (!post) return;
    expect(post.keyTakeaways).toEqual(["takeaway1", "takeaway2"]);
    expect(post.commentHighlights).toEqual([
      { author: "dev1", insight: "Great", score: 10 },
    ]);
  });

  it("defaults null JSON fields to empty arrays", () => {
    const input = makeDigestWithRelations({
      digestPosts: [
        {
          rank: 1,
          subreddit: "typescript",
          post: {
            title: "Null JSON",
            permalink: "/r/typescript/comments/abc/null",
            score: 50,
            summaries: [
              {
                summary: "Null fields.",
                keyTakeaways: null,
                insightNotes: "notes",
                commentHighlights: null,
              },
            ],
          },
        },
      ],
    });
    const result = buildDeliveryData(input);

    const ts = result.subreddits.find((s) => s.name === "typescript");
    expect(ts).toBeDefined();
    if (!ts) return;
    const post = ts.posts[0];
    expect(post).toBeDefined();
    if (!post) return;
    expect(post.keyTakeaways).toEqual([]);
    expect(post.commentHighlights).toEqual([]);
  });

  it("maps post fields correctly", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    const rust = result.subreddits.find((s) => s.name === "rust");
    expect(rust).toBeDefined();
    if (!rust) return;
    const post = rust.posts[0];
    expect(post).toBeDefined();
    if (!post) return;
    expect(post.title).toBe("Rust 2026");
    expect(post.permalink).toBe("/r/rust/comments/ghi/rust-2026");
    expect(post.score).toBe(300);
    expect(post.summary).toBe("Rust edition 2026.");
    expect(post.insightNotes).toBe("Edition release");
  });
});

function makeDeliveryData(
  overrides?: Partial<DigestDeliveryData>,
): DigestDeliveryData {
  return {
    digestId: "digest-001",
    createdAt: new Date("2026-03-10T12:00:00Z"),
    subreddits: [
      {
        name: "typescript",
        posts: [
          {
            title: "TS 6.0 Released",
            permalink: "/r/typescript/comments/abc/ts-60",
            score: 250,
            summary: "TypeScript 6.0 adds new features.",
            keyTakeaways: ["Better types", "Faster compiler"],
            insightNotes: "Major release",
            commentHighlights: [
              { author: "dev1", insight: "Great update", score: 50 },
            ],
          },
        ],
      },
      {
        name: "rust",
        posts: [
          {
            title: "Rust 2026",
            permalink: "/r/rust/comments/ghi/rust-2026",
            score: 300,
            summary: "Rust edition 2026.",
            keyTakeaways: [],
            insightNotes: "Edition release",
            commentHighlights: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("buildFormattedDigest", () => {
  it("merges prose headline and sections with post links from delivery data", () => {
    const data = makeDeliveryData();
    const prose = {
      headline: "Big week for TypeScript and Rust.",
      sections: [
        { subreddit: "typescript", body: "TS 6.0 dropped with major improvements." },
        { subreddit: "rust", body: "Rust edition 2026 is here." },
      ],
    };

    const result = buildFormattedDigest(data, prose);

    expect(result.headline).toBe("Big week for TypeScript and Rust.");
    expect(result.sections).toHaveLength(2);

    const tsSection = result.sections[0];
    expect(tsSection).toBeDefined();
    if (!tsSection) return;
    expect(tsSection.subreddit).toBe("typescript");
    expect(tsSection.body).toBe("TS 6.0 dropped with major improvements.");
    expect(tsSection.posts).toHaveLength(1);
    const tsPost = tsSection.posts[0];
    expect(tsPost).toBeDefined();
    if (!tsPost) return;
    expect(tsPost.title).toBe("TS 6.0 Released");
    expect(tsPost.permalink).toBe("/r/typescript/comments/abc/ts-60");
    expect(tsPost.score).toBe(250);

    const rustSection = result.sections[1];
    expect(rustSection).toBeDefined();
    if (!rustSection) return;
    expect(rustSection.subreddit).toBe("rust");
    expect(rustSection.body).toBe("Rust edition 2026 is here.");
    expect(rustSection.posts).toHaveLength(1);
  });

  it("handles missing subreddit in delivery data by falling back to empty posts", () => {
    const data = makeDeliveryData();
    const prose = {
      headline: "Highlights from the week.",
      sections: [
        { subreddit: "golang", body: "Go news this week." },
      ],
    };

    const result = buildFormattedDigest(data, prose);

    expect(result.sections).toHaveLength(1);
    const goSection = result.sections[0];
    expect(goSection).toBeDefined();
    if (!goSection) return;
    expect(goSection.subreddit).toBe("golang");
    expect(goSection.body).toBe("Go news this week.");
    expect(goSection.posts).toEqual([]);
  });

  it("preserves createdAt from delivery data", () => {
    const data = makeDeliveryData({
      createdAt: new Date("2026-06-15T08:30:00Z"),
    });
    const prose = {
      headline: "Mid-year digest.",
      sections: [],
    };

    const result = buildFormattedDigest(data, prose);

    expect(result.createdAt).toEqual(new Date("2026-06-15T08:30:00Z"));
  });
});
