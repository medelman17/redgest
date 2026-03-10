import { describe, it, expect } from "vitest";
import type { DigestDeliveryData } from "@redgest/email";
import { formatDigestBlocks } from "../format.js";

function makeDigest(
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
            title: "Test Post",
            permalink: "/r/typescript/comments/abc/test",
            score: 100,
            summary: "A test post summary.",
            keyTakeaways: ["takeaway one", "takeaway two"],
            insightNotes: "notes",
            commentHighlights: [],
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
    const divider = blocks[1];
    const subSection = blocks[2];
    expect(divider).toBeDefined();
    expect(divider?.type).toBe("divider");
    expect(subSection).toBeDefined();
    expect(subSection?.type).toBe("section");
    expect(subSection?.text?.text).toBe("*r/typescript*");
    expect(subSection?.text?.type).toBe("mrkdwn");
  });

  it("formats post with mrkdwn link, score, and summary", () => {
    const blocks = formatDigestBlocks(makeDigest());
    const postBlock = blocks[3];
    expect(postBlock).toBeDefined();
    expect(postBlock?.type).toBe("section");
    expect(postBlock?.text?.type).toBe("mrkdwn");
    expect(postBlock?.text?.text).toContain(
      "*<https://reddit.com/r/typescript/comments/abc/test|Test Post>*",
    );
    expect(postBlock?.text?.text).toContain("(100 pts)");
    expect(postBlock?.text?.text).toContain("A test post summary.");
  });

  it("formats key takeaways as bullet list", () => {
    const blocks = formatDigestBlocks(makeDigest());
    const takeawayBlock = blocks[4];
    expect(takeawayBlock).toBeDefined();
    expect(takeawayBlock?.type).toBe("section");
    expect(takeawayBlock?.text?.text).toContain("*Key Takeaways:*");
    expect(takeawayBlock?.text?.text).toContain("\u2022 takeaway one");
    expect(takeawayBlock?.text?.text).toContain("\u2022 takeaway two");
  });

  it("skips key takeaways block when array is empty", () => {
    const digest = makeDigest({
      subreddits: [
        {
          name: "typescript",
          posts: [
            {
              title: "No Takeaways",
              permalink: "/r/typescript/comments/xyz/no-takeaways",
              score: 50,
              summary: "No takeaways here.",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
            },
          ],
        },
      ],
    });
    const blocks = formatDigestBlocks(digest);
    // header, divider, sub section, post section — no takeaway block
    expect(blocks).toHaveLength(4);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(["header", "divider", "section", "section"]);
  });

  it("skips subreddits with no posts", () => {
    const digest = makeDigest({
      subreddits: [
        { name: "empty", posts: [] },
        {
          name: "notempty",
          posts: [
            {
              title: "Post",
              permalink: "/r/notempty/comments/1/post",
              score: 10,
              summary: "Summary.",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
            },
          ],
        },
      ],
    });
    const blocks = formatDigestBlocks(digest);
    // header, divider, sub section (notempty), post section — no "empty" sub
    expect(blocks).toHaveLength(4);
    const subBlock = blocks[2];
    expect(subBlock?.text?.text).toBe("*r/notempty*");
  });

  it("handles multiple subreddits with multiple posts", () => {
    const digest = makeDigest({
      subreddits: [
        {
          name: "sub1",
          posts: [
            {
              title: "P1",
              permalink: "/r/sub1/p1",
              score: 1,
              summary: "s1",
              keyTakeaways: ["t1"],
              insightNotes: "",
              commentHighlights: [],
            },
            {
              title: "P2",
              permalink: "/r/sub1/p2",
              score: 2,
              summary: "s2",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
            },
          ],
        },
        {
          name: "sub2",
          posts: [
            {
              title: "P3",
              permalink: "/r/sub2/p3",
              score: 3,
              summary: "s3",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
            },
          ],
        },
      ],
    });
    const blocks = formatDigestBlocks(digest);
    // header
    // divider, sub1 section, P1 section, P1 takeaways, P2 section
    // divider, sub2 section, P3 section
    expect(blocks).toHaveLength(9);
  });
});
