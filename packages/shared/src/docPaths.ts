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
