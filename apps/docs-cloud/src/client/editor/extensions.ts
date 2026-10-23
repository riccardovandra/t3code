import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/**
 * The editor's whole extension list, the one place to add nodes such as a
 * mermaid node view. Every extension must round-trip through markdown, since
 * tabs are stored and served to agents as markdown (diagrams are ```mermaid
 * fenced code blocks).
 */
export const createEditorExtensions = () => [
  StarterKit.configure({ link: { openOnClick: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Markdown,
];
