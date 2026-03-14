"use client";

import Markdown from "react-markdown";

interface DigestContentProps {
  markdown: string;
}

export function DigestContent({ markdown }: DigestContentProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <Markdown>{markdown}</Markdown>
    </div>
  );
}
