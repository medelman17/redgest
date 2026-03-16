import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { DigestEmail } from "../template.js";
import type { FormattedDigest } from "../types.js";

function makeDigest(overrides?: Partial<FormattedDigest>): FormattedDigest {
  return {
    createdAt: new Date("2026-03-10T12:00:00Z"),
    headline:
      "TypeScript 6.0 lands with major type inference improvements and faster compilation.",
    sections: [
      {
        subreddit: "typescript",
        body: "The community is buzzing about TypeScript 6.0, which brings new control flow analysis and faster compilation. Several developers noted its impact on monorepo tooling.",
        posts: [
          {
            title: "TypeScript 6.0 Released",
            permalink:
              "/r/typescript/comments/abc123/typescript_60_released",
            score: 542,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("DigestEmail template", () => {
  it("renders without throwing", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toBeDefined();
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("contains the digest date", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("2026-03-10");
  });

  it("contains the subreddit name", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("r/typescript");
  });

  it("contains the post title", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("TypeScript 6.0 Released");
  });

  it("contains the post permalink as a full URL", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain(
      "https://reddit.com/r/typescript/comments/abc123/typescript_60_released",
    );
  });

  it("contains the headline", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain(
      "TypeScript 6.0 lands with major type inference improvements",
    );
  });

  it("contains per-subreddit prose body", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("community is buzzing about TypeScript 6.0");
    expect(html).toContain("new control flow analysis and faster compilation");
  });

  it("contains post links with scores", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("TypeScript 6.0 Released");
    expect(html).toContain("542");
    expect(html).toContain(
      "https://reddit.com/r/typescript/comments/abc123/typescript_60_released",
    );
  });

  it("renders multiple subreddits", async () => {
    const digest = makeDigest({
      sections: [
        {
          subreddit: "typescript",
          body: "TypeScript news and updates.",
          posts: [
            {
              title: "Post A",
              permalink: "/r/typescript/comments/a/post_a",
              score: 10,
            },
          ],
        },
        {
          subreddit: "rust",
          body: "Rust ecosystem developments.",
          posts: [
            {
              title: "Post B",
              permalink: "/r/rust/comments/b/post_b",
              score: 20,
            },
          ],
        },
      ],
    });
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("r/typescript");
    expect(html).toContain("r/rust");
    expect(html).toContain("Post A");
    expect(html).toContain("Post B");
  });

  it("handles empty posts array gracefully", async () => {
    const digest = makeDigest({
      sections: [
        {
          subreddit: "test",
          body: "A section with no post links.",
          posts: [],
        },
      ],
    });
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("test");
    expect(html).toContain("A section with no post links.");
  });
});
