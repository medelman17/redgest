import { Resend } from "resend";
import type { FormattedDigest } from "./types.js";
import { renderDigestHtml } from "./render.js";

export async function sendDigestEmail(
  digest: FormattedDigest,
  recipientEmail: string,
  apiKey: string,
): Promise<{ id: string }> {
  const resend = new Resend(apiKey);
  const html = await renderDigestHtml(digest);
  const dateStr = digest.createdAt.toISOString().split("T")[0] ?? "";

  const result = await resend.emails.send({
    from: "Redgest <redgest@mail.edel.sh>",
    to: recipientEmail,
    subject: `Reddit Digest — ${dateStr}`,
    html,
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }

  if (!result.data) {
    throw new Error("Resend returned no data");
  }

  return { id: result.data.id };
}
