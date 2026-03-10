import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { DigestEmail } from "../template.js";
import type { DigestDeliveryData } from "../types.js";

function makeDigest(overrides?: Partial<DigestDeliveryData>): DigestDeliveryData {
  return {
    digestId: "digest-001",
    createdAt: new Date("2026-03-10T12:00:00Z"),
    subreddits: [
      {
        name: "typescript",
        posts: [
          {
            title: "TypeScript 6.0 Released",
            permalink: "/r/typescript/comments/abc123/typescript_60_released",
            score: 542,
            summary: "TypeScript 6.0 brings major improvements to type inference.",
            keyTakeaways: [
              "New control flow analysis",
              "Faster compilation",
            ],
            insightNotes: "Relevant to our project migration timeline.",
            commentHighlights: [
              {
                author: "devguru",
                insight: "The new inference is a game changer for monorepos.",
                score: 128,
              },
            ],
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

  it("contains key takeaways", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("New control flow analysis");
    expect(html).toContain("Faster compilation");
  });

  it("contains insight notes", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("Relevant to our project migration timeline.");
  });

  it("contains comment highlights", async () => {
    const digest = makeDigest();
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("devguru");
    expect(html).toContain("game changer for monorepos");
  });

  it("renders multiple subreddits", async () => {
    const digest = makeDigest({
      subreddits: [
        {
          name: "typescript",
          posts: [
            {
              title: "Post A",
              permalink: "/r/typescript/comments/a/post_a",
              score: 10,
              summary: "Summary A",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
            },
          ],
        },
        {
          name: "rust",
          posts: [
            {
              title: "Post B",
              permalink: "/r/rust/comments/b/post_b",
              score: 20,
              summary: "Summary B",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
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

  it("handles empty key takeaways gracefully", async () => {
    const digest = makeDigest({
      subreddits: [
        {
          name: "test",
          posts: [
            {
              title: "Minimal Post",
              permalink: "/r/test/comments/x/minimal",
              score: 1,
              summary: "A minimal post.",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
            },
          ],
        },
      ],
    });
    const html = await render(<DigestEmail digest={digest} />);
    expect(html).toContain("Minimal Post");
    expect(html).not.toContain("Key Takeaways");
  });
});
