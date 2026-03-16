import { describe, it, expect } from "vitest";
import type { FormattedDigest } from "@redgest/email";
import { formatDigestBlocks } from "../format";

function makeDigest(
  overrides?: Partial<FormattedDigest>,
): FormattedDigest {
  return {
    createdAt: new Date("2026-03-10T12:00:00Z"),
    headline: "Test headline.",
    sections: [
      {
        subreddit: "typescript",
        body: "Test body prose.",
        posts: [
          {
            title: "Test Post",
            permalink: "/r/typescript/comments/abc/test",
            score: 100,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("formatDigestBlocks", () => {
  it("returns a header block with the digest date", () => {
    const blocks = formatDigestBlocks(makeDigest());
    const header = blocks[0];
    expect(header).toBeDefined();
    expect(header?.type).toBe("header");
    expect(header?.text?.text).toBe("Reddit Digest — 2026-03-10");
    expect(header?.text?.type).toBe("plain_text");
    expect(header?.text?.emoji).toBe(true);
  });

  it("produces divider and subreddit section blocks", () => {
    const blocks = formatDigestBlocks(makeDigest());
    const headline = blocks[1];
    const divider = blocks[2];
    const subSection = blocks[3];
    expect(headline).toBeDefined();
    expect(headline?.type).toBe("section");
    expect(headline?.text?.text).toBe("Test headline.");
    expect(divider).toBeDefined();
    expect(divider?.type).toBe("divider");
    expect(subSection).toBeDefined();
    expect(subSection?.type).toBe("section");
    expect(subSection?.text?.text).toBe("*r/typescript*");
    expect(subSection?.text?.type).toBe("mrkdwn");
  });

  it("formats body prose block and context block with post links", () => {
    const blocks = formatDigestBlocks(makeDigest());
    const bodyBlock = blocks[4];
    expect(bodyBlock).toBeDefined();
    expect(bodyBlock?.type).toBe("section");
    expect(bodyBlock?.text?.type).toBe("mrkdwn");
    expect(bodyBlock?.text?.text).toBe("Test body prose.");

    const contextBlock = blocks[5];
    expect(contextBlock).toBeDefined();
    expect(contextBlock?.type).toBe("context");
    expect(contextBlock?.elements).toBeDefined();
    const linkText = contextBlock?.elements?.[0]?.text ?? "";
    expect(linkText).toContain(
      "<https://reddit.com/r/typescript/comments/abc/test|Test Post>",
    );
    expect(linkText).toContain("(100 pts)");
  });

  it("skips subreddits with no posts", () => {
    const digest = makeDigest({
      sections: [
        { subreddit: "empty", body: "Nothing here.", posts: [] },
        {
          subreddit: "notempty",
          body: "Some content.",
          posts: [
            {
              title: "Post",
              permalink: "/r/notempty/comments/1/post",
              score: 10,
            },
          ],
        },
      ],
    });
    const blocks = formatDigestBlocks(digest);
    // header (1) + headline (1) + divider (1) + sub section (1) + body (1) + context (1) = 6
    expect(blocks).toHaveLength(6);
    const subBlock = blocks[3];
    expect(subBlock?.text?.text).toBe("*r/notempty*");
  });

  it("handles multiple subreddits with multiple posts", () => {
    const digest = makeDigest({
      sections: [
        {
          subreddit: "sub1",
          body: "Sub1 body.",
          posts: [
            {
              title: "P1",
              permalink: "/r/sub1/p1",
              score: 1,
            },
            {
              title: "P2",
              permalink: "/r/sub1/p2",
              score: 2,
            },
          ],
        },
        {
          subreddit: "sub2",
          body: "Sub2 body.",
          posts: [
            {
              title: "P3",
              permalink: "/r/sub2/p3",
              score: 3,
            },
          ],
        },
      ],
    });
    const blocks = formatDigestBlocks(digest);
    // header (1) + headline (1)
    // sub1: divider (1) + sub section (1) + body (1) + context (1) = 4
    // sub2: divider (1) + sub section (1) + body (1) + context (1) = 4
    // total = 2 + 4 + 4 = 10
    expect(blocks).toHaveLength(10);
  });
});
