# AI PM project overview

To keep AI PM beside your conversation, open the workspace panel and choose **AI PM** from **Open a surface** or the **+** menu. Press **A** while the empty surface picker is focused to open it. The panel reads the board on the conversation’s environment; you can open project briefs without leaving the chat. Close its tab to return to another surface.

For a full-page overview, open **AI PM** from the left sidebar or search for **Open AI PM** in the command palette. Choose the environment whose project board you want to read.

The overview lists open AI PM projects, with projects needing your input first. Search by project, client or current focus. Open a brief to see its objective, current focus, next actions, risks and plan. Expand a step for its dependencies and latest recorded update.

This first version reads the existing AI PM board. It does not change projects, start agents, reconcile status or merge work. A recorded completion is the board's status, not an independent verification. Read timestamps show when the board was fetched; use Refresh projects or Refresh brief to fetch again. If refresh fails, previously loaded information stays visible with the error.

The selected environment needs the `aipm` CLI installed and configured for its board. If the executable is elsewhere, start that environment with `T3CODE_AIPM_EXECUTABLE` set to its absolute path. Each environment reads its own board. The browser does not read files from your computer.
