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
import type { FormattedDigest } from "./types.js";

interface DigestEmailProps {
  digest: FormattedDigest;
}

export function DigestEmail({ digest }: DigestEmailProps) {
  const dateStr = digest.createdAt.toISOString().split("T")[0] ?? "";

  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", color: "#333" }}>
        <Container style={{ maxWidth: "600px", margin: "0 auto" }}>
          <Heading as="h1">Reddit Digest — {dateStr}</Heading>
          <Text style={{ fontSize: "16px", lineHeight: "1.6" }}>
            {digest.headline}
          </Text>
          <Hr />

          {digest.sections.map((section) => (
            <Section key={section.subreddit} style={{ marginBottom: "24px" }}>
              <Heading as="h2">r/{section.subreddit}</Heading>
              <Text style={{ fontSize: "15px", lineHeight: "1.6" }}>
                {section.body}
              </Text>
              {section.posts.length > 0 && (
                <Section style={{ marginTop: "8px" }}>
                  {section.posts.map((post) => (
                    <Text
                      key={post.permalink}
                      style={{ margin: "4px 0", fontSize: "14px" }}
                    >
                      <Link href={`https://reddit.com${post.permalink}`}>
                        {post.title}
                      </Link>{" "}
                      <span style={{ color: "#888" }}>({post.score} pts)</span>
                    </Text>
                  ))}
                </Section>
              )}
            </Section>
          ))}
        </Container>
      </Body>
    </Html>
  );
}
