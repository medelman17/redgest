import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Hr,
  Link,
} from "@react-email/components";
import type { DigestDeliveryData } from "./types.js";

interface DigestEmailProps {
  digest: DigestDeliveryData;
}

export function DigestEmail({ digest }: DigestEmailProps) {
  const dateStr = digest.createdAt.toISOString().split("T")[0] ?? "";

  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", color: "#333" }}>
        <Container style={{ maxWidth: "600px", margin: "0 auto" }}>
          <Heading as="h1">Reddit Digest — {dateStr}</Heading>

          {digest.subreddits.map((sub) => (
            <Section key={sub.name}>
              <Heading as="h2">r/{sub.name}</Heading>
              <Hr />
              {sub.posts.map((post) => (
                <Section key={post.permalink} style={{ marginBottom: "24px" }}>
                  <Heading as="h3">
                    <Link href={`https://reddit.com${post.permalink}`}>
                      {post.title}
                    </Link>
                  </Heading>
                  <Text style={{ fontSize: "14px", color: "#666" }}>
                    {post.score} pts
                  </Text>
                  <Text>{post.summary}</Text>
                  {post.keyTakeaways.length > 0 && (
                    <Section>
                      <Text
                        style={{ fontWeight: "bold", marginBottom: "4px" }}
                      >
                        Key Takeaways:
                      </Text>
                      {post.keyTakeaways.map((t, i) => (
                        <Text key={i} style={{ margin: "2px 0 2px 16px" }}>
                          - {t}
                        </Text>
                      ))}
                    </Section>
                  )}
                  {post.insightNotes && (
                    <Text style={{ fontStyle: "italic", color: "#555" }}>
                      {post.insightNotes}
                    </Text>
                  )}
                  {post.commentHighlights.length > 0 && (
                    <Section>
                      <Text
                        style={{ fontWeight: "bold", marginBottom: "4px" }}
                      >
                        Comment Highlights:
                      </Text>
                      {post.commentHighlights.map((c, i) => (
                        <Text
                          key={i}
                          style={{
                            margin: "4px 0 4px 16px",
                            fontSize: "14px",
                          }}
                        >
                          u/{c.author} ({c.score} pts): {c.insight}
                        </Text>
                      ))}
                    </Section>
                  )}
                </Section>
              ))}
            </Section>
          ))}
        </Container>
      </Body>
    </Html>
  );
}
