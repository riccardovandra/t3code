import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { createEditorExtensions } from "./extensions.ts";

const EXTERNAL_CONTENT_META = "docsCloudExternalContent";

/**
 * A TipTap editor over one tab's markdown. Mount it keyed by tab id. The
 * editor owns its content while the user types; a new `revision` means the
 * tab changed elsewhere and `markdown` replaces the content. Echoes of our own
 * saves do not bump the revision, so they never reset the caret.
 */
export function TabEditor(props: {
  readonly markdown: string;
  readonly revision: number;
  readonly onChange: (markdown: string) => void;
  readonly onEditor?: (editor: Editor | null) => void;
}) {
  const onChange = useRef(props.onChange);
  useLayoutEffect(() => {
    onChange.current = props.onChange;
  });
  const knownMarkdown = useRef(props.markdown);

  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: props.markdown,
    contentType: "markdown",
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta(EXTERNAL_CONTENT_META)) return;
      const markdown = current.getMarkdown();
      knownMarkdown.current = markdown;
      onChange.current(markdown);
    },
  });

  const { onEditor } = props;
  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  const latestMarkdown = useRef(props.markdown);
  const appliedRevision = useRef(props.revision);
  useLayoutEffect(() => {
    latestMarkdown.current = props.markdown;
  });
  useEffect(() => {
    if (props.revision === appliedRevision.current) return;
    appliedRevision.current = props.revision;
    if (latestMarkdown.current === knownMarkdown.current) return;
    knownMarkdown.current = latestMarkdown.current;
    editor
      .chain()
      .setMeta(EXTERNAL_CONTENT_META, true)
      .setContent(latestMarkdown.current, { contentType: "markdown", emitUpdate: false })
      .run();
  }, [editor, props.revision]);

  return <EditorContent editor={editor} className="tab-editor" />;
}
