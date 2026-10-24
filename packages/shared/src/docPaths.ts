export const DOCS_ROOT = "docs";

export function docTitleFromPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  return name.replace(/[-_]+/g, " ").trim() || name;
}

export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

/**
 * The editors' markdown converters drop structure they have no node for.
 * Saving such a doc from a rich editor would silently rewrite it, so these
 * docs open read-only.
 */
export function unsupportedMarkdownReason(markdown: string): string | null {
  if (/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(markdown)) return "front matter";
  if (/^\s{0,3}<(?!!--)[a-zA-Z][^>]*>/m.test(markdown)) return "HTML blocks";
  if (/^\s{0,3}\[\^[^\]]+\]:/m.test(markdown)) return "footnotes";
  return null;
}

export const DOC_EXCERPT_MAX_LENGTH = 280;

/**
 * A short plain-text preview for a doc card in the conversation. The leading
 * title heading is dropped because the card shows the title already.
 */
export function docExcerpt(markdown: string, maxLength = DOC_EXCERPT_MAX_LENGTH): string {
  const text = markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/^\s*#\s+[^\n]*\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
