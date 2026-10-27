# Docs

Docs is Docs Cloud beside the chat: a doc editor with nested tabs, comments and rich tables that every agent can write to. Your project's markdown files under `docs/` open in the same editor, so plans in the repository and docs in Docs Cloud sit in one place.

To open Docs, choose **Docs** from **Open a surface** or the **+** menu in the workspace panel, press **O** while the empty surface picker is focused, or search for **Open Docs** in the command palette.

## Connect Docs Cloud

Go to **Settings → MCP Servers → Docs Cloud**, enter its URL and an API token created under Settings in Docs Cloud, and choose **Connect**. The token is stored on the environment and never sent back to the app. **Turn off** removes the connection and the token; your docs stay in Docs Cloud. Until an environment is connected, Docs shows **Connect Docs Cloud**, which takes you there. Sign in to Docs Cloud inside the panel the first time.

## Project files

The library's home lists **Project files**: the markdown files under the thread's `docs/` folder. Open one to read and edit it with the same toolbar and outline as a Docs Cloud doc. Edits save to the file in the thread's project folder, so they show up in diffs and commits like any other file. When an agent finishes a turn, open files and the list reload. If the file changed on disk since you opened it, your save is refused and the current text loads instead.

Files that use raw HTML, front matter or footnotes open read-only, because the editor cannot save those without changing them; ask the agent to edit them. They are also read-only on a connection that cannot write files. The editor saves italics as `*text*` and lines up table columns, so the first edit to a hand-written file may change that spacing. Images cannot be pasted into project files. **New file** beside **Project files** creates one in `docs/`, named after the title you give it; an existing file is never overwritten.

Comments on project files are stored by the environment running the project, not in the file. Every thread and worktree of that project on that environment shares them, but they are not committed to git.

To turn a project file into a Docs Cloud doc, open it and choose **Move to Docs Cloud**, or ask an agent to import several. The doc goes into the project's Docs Cloud project, and open comments come along when their quoted text is still in the doc. The file and its comments stay where they are. After that the file shows **Open in Docs Cloud**, and **Update** copies the file's current text into the doc again.

## Agents

Ask any agent for a document, plan, spec or notes to keep and it writes a Docs Cloud doc instead of pasting text into chat. The doc opens in the panel with a card in the conversation, and a tab it adds shows a notice with **Open**. Agents can also list, read, open and comment on project files, and answer comments on them, so you can ask for things like "review docs/plan.md and leave comments". Agents in threads started before Docs Cloud was connected, and agents without Docs Cloud's tools, write markdown files under `docs/` instead.

## Editing in Docs Cloud

The doc's title at the top opens its menu: rename, move to another project, copy its link, set its status (Thinking, Plan, In progress, Done; the library can be filtered by it), export, and, for its owner, delete it. The row below switches between tabs (**Tab ▾** also adds, renames, moves and deletes them) and inserts diagrams, tables, images and checklists, with more under **+**. The width button widens the column; it is remembered on that browser. Paste or drop an image to add it (PNG, JPEG, GIF or WebP, up to 10 MB); images only show to people the doc is shared with. Viewers see the doc read-only, and commenters can comment but not edit. When a doc is ready to drive work, choose **Start chat** in its header: T3 Code opens a new thread in the current project with a drafted message that points the agent at the doc as its plan, and shows the doc beside it. Review the message and send it. Once sent, the thread appears under **Threads** beside the tab switcher; threads from another T3 Code environment show as labels only. Select text to get a toolbar with **Comment** and, if you can edit, text style, bold, italic, underline, strikethrough, inline code, lists and link. In the Docs panel, a new comment has **Add to chat** ticked: when you post it, the comment also lands in the conversation's composer as a chip, like a file comment. Add several, then send them with your message in one go; the agent edits the doc, replies in each comment thread and resolves it. Untick it to only comment. **Add to chat** on an existing thread adds it later. Removing the chip leaves the comment in Docs Cloud.

Every doc or project file you open stays open as a tab in the strip at the top, so you can switch between a spec and its plan without going back to the library; the house icon returns to it. Cmd-click (Ctrl-click on Windows and Linux) a doc card or a link to a doc to open it in a tab without leaving the current one. Open tabs are remembered on that browser.

Docs Cloud's projects are your T3 Code projects. A project with a git remote is matched by its `origin` repository, so every checkout of it, on any machine you connect, shares one Docs Cloud project, and a fork stays separate from the repository it was forked from; a project without a remote is matched by its name (ignoring case and spacing). Threads started without a project keep their docs in **No project**. T3 Code adds its projects to Docs Cloud when it starts and when you add or rename one, and Docs Cloud shows the latest name. The panel opens on the current project's docs; **All projects** shows the rest, including docs in **No project**.

Rich tables track work in a doc: each column is text, a status (a coloured chip chosen from a list), a link, a number or a date. Click a cell to edit it; **Tab** moves to the next cell (past the last one it adds a row) and **Return** to the cell below. Click a column header to rename it, change its type or edit its status options; the handle at the start of a row inserts or deletes rows. Wide tables scroll sideways with the first column kept in view. To comment on one cell, hover it and choose **Comment**; the thread sits beside the cell and stays with it when rows move. To comment on a diagram label, click the label, then **Comment**. Ask an agent for "a table of these requests" and it builds one, then fills or updates cells as it works. Markdown downloads show rich tables as plain markdown tables.

**Share → Export** downloads the whole doc or the open tab as Word (`.docx`, with headings that show in Word's navigation pane, lists, rich tables and links; diagrams become a link back to the doc) or Markdown, or prints it to PDF. Inside T3 Code, **Send to → Notion** copies the doc into a new private page through a Notion MCP server you have connected under **Settings → MCP Servers**; without one, it tells you to connect it. The copy does not stay in sync, so share the link when the reader should see later changes.

The panel loads Docs Cloud directly in your browser, so it works the same over remote connections. Browsers that block cookies inside embedded pages, such as Safari, may not keep you signed in there; use **Open in browser** in the panel header instead.

On mobile, **Docs** in a thread's header opens your Docs Cloud library with the thread's project files, and tapping a doc card in the conversation opens that doc or file. You edit and comment on project files there as on desktop, and **Add to chat** puts a comment in the thread's draft. Sign in inside that screen the first time. Links to other sites open in your browser.
