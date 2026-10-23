import type { ProviderInstanceEntry } from "~/providerInstances";

export interface CopyToClaudeDocRequest {
  readonly docId: string;
  readonly title: string;
  readonly url: string;
}

const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE_LENGTH = 500;

/**
 * The frame's `t3-docs:copy-to-claude-doc` message, or null. The URL must be
 * the doc's own page on the configured Docs Cloud origin, because it goes into
 * an auto-sent prompt.
 */
export function parseCopyToClaudeDocMessage(
  value: unknown,
  origin: string,
): CopyToClaudeDocRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== "t3-docs:copy-to-claude-doc") return null;
  const { docId, title, url } = message;
  if (typeof docId !== "string" || !DOC_ID.test(docId)) return null;
  if (typeof title !== "string" || title.length > MAX_TITLE_LENGTH) return null;
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin || parsed.pathname !== `/d/${docId}`) return null;
  } catch {
    return null;
  }
  return { docId, title: title.trim() || "Untitled", url };
}

/** Only Claude instances can reach claude.ai's Claude Docs connector. */
export function claudeDocInstances(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  return entries.filter((entry) => entry.driverKind === "claudeAgent" && entry.enabled);
}

export function copyToClaudeDocThreadTitle(request: CopyToClaudeDocRequest): string {
  return `Copy to Claude Doc: ${request.title}`;
}

/**
 * Prompt-driven by design: the agent maps Docs Cloud markdown to Claude Docs
 * with Claude Docs' own guide, so there is no format converter to maintain.
 */
export function buildCopyToClaudeDocPrompt(request: CopyToClaudeDocRequest): string {
  const title = JSON.stringify(request.title);
  return `Copy this Docs Cloud doc into Claude Docs on claude.ai.

Doc: ${title}
Docs Cloud doc id: ${request.docId}
URL: ${request.url}

1. Check your tools first. You need the docs-cloud read_doc tool and the claude.ai Claude Docs tools (named like mcp__claude_ai_Claude_Docs__batch, update, read and guide). If either is missing, stop and reply in one or two sentences naming what is missing; for Claude Docs, say this Claude account needs the claude.ai Claude Docs connector. Do not create a local file, a Docs Cloud doc or any other substitute.
2. Read the whole doc with read_doc, docId "${request.docId}" and no tabId. It returns every tab in reading order with its title, depth and markdown.
3. Load the Claude Docs guide before your first Claude Docs call if it is not already loaded (topic.index, then the tabs and diagram topics).
4. Create one Claude Doc titled exactly ${title}. Recreate every tab with the same title, in the same order and with the same nesting: depth 0 tabs at the top level, each deeper tab as a child of the nearest tab above it with a smaller depth. Copy each tab's content faithfully, including headings, lists, tables, links and code blocks. Keep \`\`\`mermaid diagrams as mermaid. Do not summarise, rewrite or add content.
5. Leave the Docs Cloud doc unchanged.
6. Reply with the Claude Doc URL and one line with the number of tabs copied. List anything that could not be copied exactly.`;
}
