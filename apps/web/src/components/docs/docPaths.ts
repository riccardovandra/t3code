/**
 * The editor's markdown converter drops structure it has no node for. Saving
 * such a doc from the rich editor would silently rewrite it, so these docs
 * open read-only and stay commentable.
 */
export function unsupportedMarkdownReason(markdown: string): string | null {
  if (/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(markdown)) return "front matter";
  if (/^\s{0,3}<(?!!--)[a-zA-Z][^>]*>/m.test(markdown)) return "HTML blocks";
  if (/^\s{0,3}\[\^[^\]]+\]:/m.test(markdown)) return "footnotes";
  return null;
}
