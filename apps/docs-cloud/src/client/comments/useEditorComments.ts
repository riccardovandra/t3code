import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DocAnchor } from "../../shared/anchors.ts";
import { buildDocTextIndex, captureDocAnchor, resolveDocAnchor } from "./editorAnchors.ts";

export interface EditorCommentAnchor extends DocAnchor {
  readonly id: string;
}

interface CommentRange {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

interface PluginState {
  readonly anchors: ReadonlyArray<EditorCommentAnchor>;
  readonly activeId: string | null;
  readonly ranges: ReadonlyArray<CommentRange>;
  readonly decorations: DecorationSet;
}

const commentsKey = new PluginKey<PluginState>("docsCloudComments");

function computeState(
  doc: ProseMirrorNode,
  anchors: ReadonlyArray<EditorCommentAnchor>,
  activeId: string | null,
): PluginState {
  const index = buildDocTextIndex(doc);
  const ranges = anchors.flatMap((anchor) => {
    const range = resolveDocAnchor(index, anchor);
    return range ? [{ id: anchor.id, ...range }] : [];
  });
  const decorations = DecorationSet.create(
    doc,
    ranges.map((range) =>
      Decoration.inline(range.from, range.to, {
        class: range.id === activeId ? "comment-mark comment-mark-active" : "comment-mark",
      }),
    ),
  );
  return { anchors, activeId, ranges, decorations };
}

interface Callbacks {
  readonly onClick: (id: string | null) => void;
  readonly onShortcut: () => void;
}

/** Highlights anchored comments, reports clicks on them, and owns Cmd/Ctrl+Option+M. */
function createCommentsPlugin(callbacks: () => Callbacks, onUpdate: () => void) {
  return new Plugin<PluginState>({
    key: commentsKey,
    state: {
      init: (_, state) => computeState(state.doc, [], null),
      apply: (tr, value, _, next) => {
        const meta = tr.getMeta(commentsKey) as
          | Pick<PluginState, "anchors" | "activeId">
          | undefined;
        if (meta) return computeState(next.doc, meta.anchors, meta.activeId);
        if (tr.docChanged) return computeState(next.doc, value.anchors, value.activeId);
        return value;
      },
    },
    props: {
      decorations: (state) => commentsKey.getState(state)?.decorations,
      handleClick: (view, pos) => {
        const ranges = commentsKey.getState(view.state)?.ranges ?? [];
        callbacks().onClick(
          ranges.find((range) => pos >= range.from && pos <= range.to)?.id ?? null,
        );
        return false;
      },
      handleKeyDown: (view, event) => {
        // Option+M types a character on macOS, so match the physical key.
        if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.code !== "KeyM") {
          return false;
        }
        if (view.state.selection.empty) return false;
        callbacks().onShortcut();
        return true;
      },
    },
    view: () => {
      onUpdate();
      return { update: onUpdate };
    },
  });
}

/** Captures an anchor for the editor's current selection, or null when nothing is selected. */
export function selectionAnchor(editor: Editor): DocAnchor | null {
  const { from, to, empty } = editor.state.selection;
  return empty ? null : captureDocAnchor(buildDocTextIndex(editor.state.doc), from, to);
}

function showAnchors(editor: Editor, state: Pick<PluginState, "anchors" | "activeId">): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(commentsKey, { anchors: state.anchors, activeId: state.activeId }),
  );
}

const sameTops = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) =>
  a.size === b.size && [...a].every(([id, top]) => b.get(id) === top);

/**
 * Wires comment anchors into the live editor. Returns where each anchored
 * comment's passage starts and where the current selection starts, both in
 * pixels from the top of `container`; a comment missing from `tops` has lost
 * its passage.
 */
export function useEditorComments(
  editor: Editor | null,
  props: Callbacks & {
    readonly anchors: ReadonlyArray<EditorCommentAnchor>;
    readonly activeId: string | null;
    readonly container: HTMLElement | null;
  },
): { readonly tops: ReadonlyMap<string, number>; readonly selectionTop: number | null } {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
  const [selectionTop, setSelectionTop] = useState<number | null>(null);
  const { container } = props;

  useEffect(() => {
    if (!editor || !container) return;
    const measure = () => {
      if (editor.isDestroyed) return;
      const origin = container.getBoundingClientRect().top;
      const next = new Map<string, number>();
      for (const range of commentsKey.getState(editor.state)?.ranges ?? []) {
        next.set(range.id, Math.round(editor.view.coordsAtPos(range.from).top - origin));
      }
      setTops((current) => (sameTops(current, next) ? current : next));
      const { from, empty } = editor.state.selection;
      setSelectionTop(
        empty || !editor.isFocused ? null : Math.round(editor.view.coordsAtPos(from).top - origin),
      );
    };
    // Measuring reads layout, so it runs after the view has updated the DOM.
    const schedule = () => queueMicrotask(measure);
    editor.registerPlugin(createCommentsPlugin(() => latest.current, schedule));
    showAnchors(editor, latest.current);
    editor.on("focus", schedule);
    editor.on("blur", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    return () => {
      observer.disconnect();
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      if (!editor.isDestroyed) editor.unregisterPlugin(commentsKey);
      setTops(new Map());
      setSelectionTop(null);
    };
  }, [editor, container]);

  const { anchors, activeId } = props;
  useEffect(() => {
    if (editor && !editor.isDestroyed) showAnchors(editor, { anchors, activeId });
  }, [editor, anchors, activeId]);

  return { tops, selectionTop };
}
