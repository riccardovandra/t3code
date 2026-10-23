# Docs

Docs are markdown files in your project's `docs/` folder that you write and review with the agent, without leaving the conversation.

To open Docs, choose **Docs** from **Open a surface** or the **+** menu in the workspace panel, press **O** while the empty surface picker is focused, or search for **Open Docs** in the command palette. Type a title and choose **Create** to start a doc, or open an existing one. Edits save automatically to the file in the thread's project folder, so they show up in diffs and commits like any other file.

Select text to format it or comment on it. Press **Cmd+Option+M** (**Ctrl+Alt+M** on Windows and Linux) to comment without the toolbar. In the comment box, **Return** posts, **Shift+Return** adds a line, and **Escape** discards. When the panel is wide, comments sit beside the text they refer to; in a narrow panel, each shows as an icon beside its line. You can reply, resolve, reopen and delete threads. **Resolved** in the header lists resolved threads.

**Send to agent** is ticked by default and remembered per doc. Comments you send go to a doc agent: a sub-thread of your conversation, one per doc, so the main chat stays clear. The agent edits the doc and replies in the comment thread; **Open agent thread** on a comment shows its work. The doc refreshes when either thread finishes a turn.

Ask any agent for a document, plan, spec or notes to keep and it writes a doc instead of pasting text into chat. The doc opens in the Docs panel, and a card in the conversation, with a short preview, reopens it beside the chat or full screen. Agents can also list, read and comment on docs, so you can ask for things like "review docs/plan.md and leave comments".

Comments are stored by the environment running the project, not in the file. Every thread and worktree of that project on that environment shares them, but they are not committed to git. When the commented text is edited, the comment follows the passage; if the passage is deleted, the comment stays and is marked **Text removed**.

Docs that use raw HTML, front matter or footnotes open read-only, because the editor cannot save those without changing them. You can still comment on them and ask the agent to edit them. The editor saves italics as `*text*` and lines up table columns, so the first edit to a hand-written doc may change that spacing.

## Docs Cloud

Docs Cloud is a hosted doc editor with nested tabs that every agent can write to. To connect it, go to **Settings → MCP Servers → Docs Cloud**, enter its URL and an API token created under Settings in Docs Cloud, and choose **Connect**. The token is stored on the environment and never sent back to the app. **Turn off** removes the connection and the token; your docs stay in Docs Cloud.

Once connected, the Docs panel shows Docs Cloud beside the chat, and **Project files** switches back to the markdown files above. Sign in to Docs Cloud inside the panel the first time. Agents in threads started afterwards get the Docs Cloud tools and use them for docs you ask for. A doc an agent creates opens in the panel with a card in the conversation, and a tab it adds shows a notice with **Open**.

Each doc has a status (Thinking, Plan, In progress, Done) that you set in its header, and the library can be filtered by it. When a doc is ready to drive work, choose **Start work** in its header: T3 Code opens a new thread in the current project with a drafted message that points the agent at the doc as its plan, and shows the doc beside it. Review the message and send it. Once sent, the thread appears under **Threads** in the doc's header; threads from another T3 Code environment show as labels only. **Send to agent** on a Docs Cloud comment goes to one doc agent sub-thread per conversation and doc, which edits the doc and replies in the comment thread.

Docs Cloud's projects are your T3 Code projects. A project with a git remote is matched by its repository, so every checkout of it, on any machine you connect, shares one Docs Cloud project; a project without a remote is matched by its name (ignoring case and spacing). T3 Code adds its projects to Docs Cloud when it starts and when you add or rename one, and Docs Cloud shows the latest name. The panel opens on the current project's docs; **All projects** shows the rest, including docs in **No project**.

To move existing file docs into Docs Cloud, open **Project files**: **Import all** moves every doc under `docs/`, and **Move to Docs Cloud** in a doc's header moves just that one. Each file becomes its own Docs Cloud doc, and open comments come along when their quoted text is still in the doc; comments whose text is gone are skipped and counted. Files and their comments stay where they are. An imported doc shows **Imported to Docs Cloud**, which opens it, and **Update**, which replaces the Docs Cloud copy with the file's current text. You can also ask an agent to import the docs.

The panel loads Docs Cloud directly in your browser, so it works the same over remote connections. Browsers that block cookies inside embedded pages, such as Safari, may not keep you signed in there; use **Open in browser** in the panel header instead.

On mobile, the cloud button in a thread's header opens your Docs Cloud library, and tapping a doc card in the conversation opens that doc. Sign in inside that screen the first time. Links to other sites open in your browser.
