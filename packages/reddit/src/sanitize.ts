/**
 * Strip XML/HTML-like tags from Reddit content before LLM processing.
 *
 * Defends against prompt injection via user-generated content by removing
 * patterns like `<system>`, `</instructions>`, or `<img onerror="...">`.
 * Does NOT attempt full HTML sanitization — only strips tag-shaped sequences.
 */
export function sanitizeContent(text: string): string {
  return text.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\/?>/g, "");
}
