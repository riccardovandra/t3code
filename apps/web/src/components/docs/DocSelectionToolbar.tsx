import type { Editor } from "@tiptap/core";
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MessageSquarePlusIcon,
  StrikethroughIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

const TOOLBAR_GAP = 8;

/**
 * Floats above a text selection, like the formatting toolbar in Claude Docs.
 * Read-only docs keep only Comment.
 */
export function DocSelectionToolbar(props: {
  readonly editor: Editor;
  readonly editable: boolean;
  readonly canComment: boolean;
  readonly onComment: () => void;
}) {
  const { editor } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const { from, to, empty } = editor.state.selection;
  const visible = !empty && (editor.isFocused || linkDraft !== null);

  useLayoutEffect(() => {
    const element = ref.current;
    const parent = element?.offsetParent;
    if (!element || !parent || !visible) return;
    const parentRect = parent.getBoundingClientRect();
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const width = element.offsetWidth;
    const center = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
    const left = Math.min(
      Math.max(0, center - parentRect.left - width / 2),
      Math.max(0, parentRect.width - width),
    );
    const top = start.top - parentRect.top - element.offsetHeight - TOOLBAR_GAP;
    setPosition({ top: Math.max(top, -element.offsetHeight), left });
  }, [editor, from, to, visible]);

  if (!visible || (!props.editable && !props.canComment)) return null;

  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    command(editor.chain().focus()).run();

  const applyLink = () => {
    const href = linkDraft?.trim() ?? "";
    setLinkDraft(null);
    if (href) run((chain) => chain.extendMarkRange("link").setLink({ href }));
    else run((chain) => chain.extendMarkRange("link").unsetLink());
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Formatting"
      className="absolute z-20 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-md"
      style={position ? { top: position.top, left: position.left } : { visibility: "hidden" }}
      // Clicking the toolbar must not move focus out of the editor and drop the selection.
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      {props.editable && linkDraft !== null ? (
        <form
          className="flex items-center gap-1 px-1"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <Input
            size="sm"
            autoFocus
            value={linkDraft}
            placeholder="Paste a link"
            aria-label="Link address"
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLinkDraft(null);
                editor.commands.focus();
              }
            }}
          />
          <Button size="xs" type="submit">
            Apply
          </Button>
        </form>
      ) : (
        <>
          {props.editable ? (
            <>
              <ToolbarButton
                label="Bold"
                active={editor.isActive("bold")}
                onClick={() => run((chain) => chain.toggleBold())}
              >
                <BoldIcon />
              </ToolbarButton>
              <ToolbarButton
                label="Italic"
                active={editor.isActive("italic")}
                onClick={() => run((chain) => chain.toggleItalic())}
              >
                <ItalicIcon />
              </ToolbarButton>
              <ToolbarButton
                label="Strikethrough"
                active={editor.isActive("strike")}
                onClick={() => run((chain) => chain.toggleStrike())}
              >
                <StrikethroughIcon />
              </ToolbarButton>
              <ToolbarButton
                label="Code"
                active={editor.isActive("code")}
                onClick={() => run((chain) => chain.toggleCode())}
              >
                <CodeIcon />
              </ToolbarButton>
              <ToolbarButton
                label="Link"
                active={editor.isActive("link")}
                onClick={() => setLinkDraft(String(editor.getAttributes("link").href ?? ""))}
              >
                <LinkIcon />
              </ToolbarButton>
              <ToolbarDivider />
              {([1, 2, 3] as const).map((level) => {
                const Icon = [Heading1Icon, Heading2Icon, Heading3Icon][level - 1]!;
                return (
                  <ToolbarButton
                    key={level}
                    label={`Heading ${level}`}
                    active={editor.isActive("heading", { level })}
                    onClick={() => run((chain) => chain.toggleHeading({ level }))}
                  >
                    <Icon />
                  </ToolbarButton>
                );
              })}
              <ToolbarDivider />
              <ToolbarButton
                label="Bulleted list"
                active={editor.isActive("bulletList")}
                onClick={() => run((chain) => chain.toggleBulletList())}
              >
                <ListIcon />
              </ToolbarButton>
              <ToolbarButton
                label="Numbered list"
                active={editor.isActive("orderedList")}
                onClick={() => run((chain) => chain.toggleOrderedList())}
              >
                <ListOrderedIcon />
              </ToolbarButton>
              <ToolbarButton
                label="Checklist"
                active={editor.isActive("taskList")}
                onClick={() => run((chain) => chain.toggleTaskList())}
              >
                <ListChecksIcon />
              </ToolbarButton>
            </>
          ) : null}
          {props.canComment ? (
            <>
              {props.editable ? <ToolbarDivider /> : null}
              <Button size="xs" variant="ghost" onClick={props.onComment}>
                <MessageSquarePlusIcon />
                Comment
              </Button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Button
      size="icon-xs"
      variant={props.active ? "secondary" : "ghost"}
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

function ToolbarDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />;
}
