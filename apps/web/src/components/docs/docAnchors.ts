import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface DocAnchor {
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
}

const CONTEXT_LENGTH = 48;

/**
 * The doc's visible text, with a newline between blocks. `positions[i]` is the
 * editor position of character `i`, or -1 for a block separator.
 */
export interface DocTextIndex {
  readonly text: string;
  readonly positions: ReadonlyArray<number>;
}

export function buildDocTextIndex(doc: ProseMirrorNode): DocTextIndex {
  let text = "";
  const positions: number[] = [];
  const separate = () => {
    if (text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
      positions.push(-1);
    }
  };
  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text ?? "";
      for (let offset = 0; offset < value.length; offset += 1) {
        text += value[offset];
        positions.push(pos + offset);
      }
      return false;
    }
    if (node.type.name === "hardBreak" || node.isTextblock) separate();
    return true;
  });
  return { text, positions };
}

/** Captures an anchor for the editor range `from..to`, or null when it holds no text. */
export function captureDocAnchor(index: DocTextIndex, from: number, to: number): DocAnchor | null {
  let start = index.positions.findIndex((position) => position >= from);
  if (start === -1) return null;
  let end = start;
  while (end < index.positions.length) {
    const position = index.positions[end]!;
    if (position !== -1 && position >= to) break;
    end += 1;
  }
  while (start < end && /\s/.test(index.text[start]!)) start += 1;
  while (end > start && /\s/.test(index.text[end - 1]!)) end -= 1;
  if (start === end) return null;
  return {
    quote: index.text.slice(start, end),
    prefix: index.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: index.text.slice(end, end + CONTEXT_LENGTH),
  };
}

/**
 * Finds the quote in `text`. With several matches, the one whose surroundings
 * best agree with the stored context wins, so a repeated phrase keeps its place.
 */
export function locateDocAnchor(
  text: string,
  anchor: DocAnchor,
): { readonly start: number; readonly end: number } | null {
  if (anchor.quote.length === 0) return null;
  let best: { start: number; score: number } | null = null;
  for (
    let start = text.indexOf(anchor.quote);
    start !== -1;
    start = text.indexOf(anchor.quote, start + 1)
  ) {
    const score =
      commonSuffixLength(text.slice(0, start), anchor.prefix) +
      commonPrefixLength(text.slice(start + anchor.quote.length), anchor.suffix);
    if (best === null || score > best.score) best = { start, score };
  }
  if (best !== null) return { start: best.start, end: best.start + anchor.quote.length };
  return locateBetweenContext(text, anchor);
}

// Longest first: a long probe is unambiguous, a short one survives a reworded neighbour.
const CONTEXT_PROBES = [24, 12, 8];

/**
 * The quoted words themselves are often what gets edited (a comment asking for
 * a change gets that change). The text between the unchanged prefix and suffix
 * is then the edited passage, so the comment stays with it.
 */
function locateBetweenContext(
  text: string,
  anchor: DocAnchor,
): { readonly start: number; readonly end: number } | null {
  for (const probe of CONTEXT_PROBES) {
    const located = locateBetweenProbes(text, anchor, probe);
    if (located) return located;
  }
  return null;
}

function locateBetweenProbes(
  text: string,
  anchor: DocAnchor,
  probe: number,
): { readonly start: number; readonly end: number } | null {
  const before = anchor.prefix.slice(-probe);
  const after = anchor.suffix.slice(0, probe);
  if (before.length < Math.min(probe, 8) || after.length < Math.min(probe, 8)) return null;
  const maxLength = anchor.quote.length * 2 + 80;
  let best: { start: number; end: number } | null = null;
  for (let at = text.indexOf(before); at !== -1; at = text.indexOf(before, at + 1)) {
    const start = at + before.length;
    const end = text.indexOf(after, start);
    if (end <= start || end - start > maxLength) continue;
    const distance = Math.abs(end - start - anchor.quote.length);
    if (best === null || distance < Math.abs(best.end - best.start - anchor.quote.length))
      best = { start, end };
  }
  if (best === null) return null;
  // Trim the separators the context did not include so the range starts and ends on text.
  while (best.start < best.end && /\s/.test(text[best.start]!))
    best = { ...best, start: best.start + 1 };
  while (best.end > best.start && /\s/.test(text[best.end - 1]!))
    best = { ...best, end: best.end - 1 };
  return best.start === best.end ? null : best;
}

/** The editor range for an anchor, or null when the quoted text is gone. */
export function resolveDocAnchor(
  index: DocTextIndex,
  anchor: DocAnchor,
): { readonly from: number; readonly to: number } | null {
  const located = locateDocAnchor(index.text, anchor);
  if (located === null) return null;
  const from = index.positions[located.start];
  const last = index.positions[located.end - 1];
  if (from === undefined || last === undefined || from === -1 || last === -1) return null;
  return { from, to: last + 1 };
}

function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function commonSuffixLength(a: string, b: string): number {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  )
    length += 1;
  return length;
}
