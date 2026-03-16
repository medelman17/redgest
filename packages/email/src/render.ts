import { createElement } from "react";
import { render } from "@react-email/components";
import { DigestEmail } from "./template";
import type { FormattedDigest } from "./types";

/**
 * Render a digest as HTML using the DigestEmail React Email template.
 * Does NOT send — use sendDigestEmail() for delivery.
 */
export async function renderDigestHtml(
  data: FormattedDigest,
): Promise<string> {
  return render(createElement(DigestEmail, { digest: data }));
}
