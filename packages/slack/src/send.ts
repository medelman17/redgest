import type { FormattedDigest } from "@redgest/email";
import { formatDigestBlocks } from "./format.js";

export async function sendDigestSlack(
  digest: FormattedDigest,
  webhookUrl: string,
): Promise<void> {
  const blocks = formatDigestBlocks(digest);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    throw new Error(
      `Slack webhook error: ${response.status} ${response.statusText}`,
    );
  }
}
