export function sanitizeContent(text: string): string {
  return text.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\/?>/g, "");
}
