# AI PM project overview

To keep AI PM beside your conversation, open the workspace panel and choose **AI PM** from **Open a surface** or the **+** menu. Press **A** while the empty surface picker is focused to open it. The panel reads the board on the conversation’s environment; you can open project briefs without leaving the chat. Close its tab to return to another surface.

For a full-page overview, open **AI PM** from the left sidebar or search for **Open AI PM** in the command palette. Choose the environment whose project board you want to read.

The overview lists open AI PM projects, with projects needing your input first. Search by project, client or current focus. Open a brief to see its objective, current focus, next actions, risks and plan. Expand a step for its dependencies and latest recorded update.

Projects are read-only here. AI PM does not change projects, start agents, reconcile status or merge work. A recorded completion is the board's status, not an independent verification. Read timestamps show when the board was fetched; use Refresh projects or Refresh brief to fetch again. If refresh fails, previously loaded information stays visible with the error.

The selected environment needs the `aipm` CLI installed and configured for its board. If the executable is elsewhere, start that environment with `T3CODE_AIPM_EXECUTABLE` set to its absolute path. Each environment reads its own board. The browser does not read files from your computer.

## Ideas

Ideas hold concepts you started exploring but had to set aside, with the threads and files where the work happened. They appear below the projects, under Active (parked or exploring), Promoted and Dropped.

To park an idea from a conversation, ask the agent to "park this idea". The agent writes where you left off and the next step, links the conversation, and adds any files it produced. You can also choose **New idea** and fill in the form. Threads are listed one id or thread link per line, and files and folders one absolute path per line.

Use **Status** on an idea to move it between parked, exploring and dropped, or to promote it to an existing AI PM project. Every status can move back to any other. Linked threads open in their conversation. Files open only when the environment runs on this computer; otherwise you can copy the path.

Ideas are stored in the AI PM data repository as `ideas/<id>.md`, so the `aipm idea` commands show and change the same ideas.
