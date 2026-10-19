# Docs

Docs are markdown files in your project's `docs/` folder that you write and review with the agent, without leaving the conversation.

To open Docs, choose **Docs** from **Open a surface** or the **+** menu in the workspace panel, press **O** while the empty surface picker is focused, or search for **Open Docs** in the command palette. Type a title and choose **Create** to start a doc, or open an existing one. Edits save automatically to the file in the thread's project folder, so they show up in diffs and commits like any other file.

Select text to format it or comment on it. Press **Cmd+Option+M** (**Ctrl+Alt+M** on Windows and Linux) to comment without the toolbar. In the comment box, **Return** posts, **Shift+Return** adds a line, and **Escape** discards. When the panel is wide, comments sit beside the text they refer to; in a narrow panel, each shows as an icon beside its line. You can reply, resolve, reopen and delete threads. **Resolved** in the header lists resolved threads.

**Send to agent** is ticked by default and remembered per doc. Comments you send go to a doc agent: a sub-thread of your conversation, one per doc, so the main chat stays clear. The agent edits the doc and replies in the comment thread; **Open agent thread** on a comment shows its work. The doc refreshes when either thread finishes a turn.

Ask any agent for a document, plan, spec or notes to keep and it writes a doc instead of pasting text into chat. The doc opens in the Docs panel, and a card in the conversation reopens it beside the chat or full screen. Agents can also list, read and comment on docs, so you can ask for things like "review docs/plan.md and leave comments".

Comments are stored by the environment running the project, not in the file. Every thread and worktree of that project on that environment shares them, but they are not committed to git. When the commented text is edited, the comment follows the passage; if the passage is deleted, the comment stays and is marked **Text removed**.

Docs that use raw HTML, front matter or footnotes open read-only, because the editor cannot save those without changing them. You can still comment on them and ask the agent to edit them. The editor saves italics as `*text*` and lines up table columns, so the first edit to a hand-written doc may change that spacing.
