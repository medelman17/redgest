const RESERVED_TAGS = /(<\/?)(reddit_post|user_interests|content_handling|system)(>)/gi;

export function sanitizeForPrompt(text: string): string {
  return text.replace(RESERVED_TAGS, (_match, open, tag, close) => {
    return `${open.replace("<", "&lt;")}${tag}${close.replace(">", "&gt;")}`;
  });
}
