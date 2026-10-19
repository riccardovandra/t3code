export const DOCS_ROOT = "docs";

export function docTitleFromPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  return name.replace(/[-_]+/g, " ").trim() || name;
}

export function slugifyDocTitle(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

/** Picks `<folder>/<slug>.md`, suffixing a number so an existing doc is never overwritten. */
export function nextDocPath(
  folder: string,
  title: string,
  existingPaths: ReadonlySet<string>,
): string {
  const slug = slugifyDocTitle(title);
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${folder}/${attempt === 1 ? slug : `${slug}-${attempt}`}.md`;
    if (!existingPaths.has(candidate.toLowerCase())) return candidate;
  }
}

export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
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
