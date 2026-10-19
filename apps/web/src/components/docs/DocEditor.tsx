import type { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";

import {
  buildDocTextIndex,
  captureDocAnchor,
  resolveDocAnchor,
  type DocAnchor,
} from "./docAnchors";
import { DocSelectionToolbar } from "./DocSelectionToolbar";

export interface DocEditorComment extends DocAnchor {
  readonly id: string;
}

interface DocRange {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

interface DocEditorCallbacks {
  readonly onChange: (markdown: string) => void;
  readonly onSelectionAnchor: (anchor: DocAnchor | null) => void;
  readonly onCommentClick: (commentId: string | null) => void;
  readonly onCommentShortcut: () => void;
  readonly onAnchorTops: (tops: ReadonlyMap<string, number>) => void;
}

interface DocCommentsState {
  readonly comments: ReadonlyArray<DocEditorComment>;
  readonly activeId: string | null;
  readonly ranges: ReadonlyArray<DocRange>;
  readonly decorations: DecorationSet;
}

const docCommentsKey = new PluginKey<DocCommentsState>("docComments");

function computeCommentsState(
  doc: ProseMirrorNode,
  comments: ReadonlyArray<DocEditorComment>,
  activeId: string | null,
): DocCommentsState {
  const index = buildDocTextIndex(doc);
  const ranges = comments.flatMap((comment) => {
    const range = resolveDocAnchor(index, comment);
    return range ? [{ id: comment.id, ...range }] : [];
  });
  const decorations = DecorationSet.create(
    doc,
    ranges.map((range) =>
      Decoration.inline(range.from, range.to, {
        class:
          range.id === activeId ? "doc-comment-mark doc-comment-mark-active" : "doc-comment-mark",
      }),
    ),
  );
  return { comments, activeId, ranges, decorations };
}

/** Highlights comments where their quote is found and owns the comment shortcut. */
function createDocCommentsPlugin(callbacks: () => DocEditorCallbacks, onRanges: () => void) {
  return new Plugin<DocCommentsState>({
    key: docCommentsKey,
    state: {
      init: (_, state) => computeCommentsState(state.doc, [], null),
      apply: (tr, value, _, nextState) => {
        const meta = tr.getMeta(docCommentsKey) as
          | Pick<DocCommentsState, "comments" | "activeId">
          | undefined;
        if (meta) return computeCommentsState(nextState.doc, meta.comments, meta.activeId);
        if (tr.docChanged)
          return computeCommentsState(nextState.doc, value.comments, value.activeId);
        return value;
      },
    },
    props: {
      decorations: (state) => docCommentsKey.getState(state)?.decorations,
      handleClick: (view, pos) => {
        const ranges = docCommentsKey.getState(view.state)?.ranges ?? [];
        const hit = ranges.find((range) => pos >= range.from && pos <= range.to);
        callbacks().onCommentClick(hit?.id ?? null);
        return false;
      },
      handleKeyDown: (_, event) => {
        // Option+M types a character on macOS, so match the physical key.
        if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.code !== "KeyM")
          return false;
        callbacks().onCommentShortcut();
        return true;
      },
    },
    view: () => {
      onRanges();
      return { update: onRanges };
    },
  });
}

const EXTERNAL_CONTENT_META = "docExternalContent";

export const createDocEditorExtensions = () => [
  StarterKit.configure({ link: { openOnClick: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Markdown,
];

export function DocEditor(props: {
  readonly markdown: string;
  readonly editable: boolean;
  readonly canComment: boolean;
  /** Hidden while a comment is being written, so it does not cover the draft. */
  readonly showToolbar: boolean;
  readonly comments: ReadonlyArray<DocEditorComment>;
  readonly activeCommentId: string | null;
  readonly onChange: (markdown: string) => void;
  readonly onSelectionAnchor: (anchor: DocAnchor | null) => void;
  readonly onCommentClick: (commentId: string | null) => void;
  readonly onCommentShortcut: () => void;
  readonly onAnchorTops: (tops: ReadonlyMap<string, number>) => void;
}) {
  const callbacks = useRef<DocEditorCallbacks>(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  // The markdown this editor last produced or loaded. The file query echoes
  // our own saves back, and only a different value means someone else wrote it.
  const knownMarkdown = useRef(props.markdown);
  const rootRef = useRef<HTMLDivElement>(null);
  // The selection toolbar reads live editor state, so each transaction rerenders it.
  const [, setSelectionVersion] = useState(0);

  const editor = useEditor({
    extensions: createDocEditorExtensions(),
    content: props.markdown,
    contentType: "markdown",
    editable: props.editable,
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta(EXTERNAL_CONTENT_META)) return;
      const markdown = current.getMarkdown();
      knownMarkdown.current = markdown;
      callbacks.current.onChange(markdown);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to, empty } = current.state.selection;
      callbacks.current.onSelectionAnchor(
        empty ? null : captureDocAnchor(buildDocTextIndex(current.state.doc), from, to),
      );
    },
    onTransaction: () => setSelectionVersion((version) => version + 1),
    onBlur: () => setSelectionVersion((version) => version + 1),
    onFocus: () => setSelectionVersion((version) => version + 1),
  });

  useEffect(() => {
    let reported = "";
    // Card tops follow their quotes, so remeasure on edits and on reflow.
    const measure = () => {
      const root = rootRef.current;
      if (!root || editor.isDestroyed) return;
      const rootTop = root.getBoundingClientRect().top;
      const tops = new Map<string, number>();
      for (const range of docCommentsKey.getState(editor.state)?.ranges ?? []) {
        tops.set(range.id, Math.round(editor.view.coordsAtPos(range.from).top - rootTop));
      }
      const key = JSON.stringify([...tops]);
      if (key === reported) return;
      reported = key;
      callbacks.current.onAnchorTops(tops);
    };
    editor.registerPlugin(
      createDocCommentsPlugin(
        () => callbacks.current,
        () => queueMicrotask(measure),
      ),
    );
    const stopObserving = rootRef.current ? observeResize(rootRef.current, measure) : undefined;
    return () => {
      stopObserving?.();
      editor.unregisterPlugin(docCommentsKey);
    };
  }, [editor]);

  useEffect(() => {
    if (props.markdown === knownMarkdown.current) return;
    knownMarkdown.current = props.markdown;
    editor
      .chain()
      .setMeta(EXTERNAL_CONTENT_META, true)
      .setContent(props.markdown, { contentType: "markdown", emitUpdate: false })
      .run();
  }, [editor, props.markdown]);

  useEffect(() => {
    editor.setEditable(props.editable, false);
  }, [editor, props.editable]);

  useEffect(() => {
    editor.view.dispatch(
      editor.state.tr.setMeta(docCommentsKey, {
        comments: props.comments,
        activeId: props.activeCommentId,
      }),
    );
  }, [editor, props.comments, props.activeCommentId]);

  return (
    <div ref={rootRef} className="relative">
      <EditorContent editor={editor} className="doc-editor" />
      {props.showToolbar ? (
        <DocSelectionToolbar
          editor={editor as Editor}
          editable={props.editable}
          canComment={props.canComment}
          onComment={props.onCommentShortcut}
        />
      ) : null}
    </div>
  );
}
