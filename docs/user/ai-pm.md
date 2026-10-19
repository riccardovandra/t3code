# AI PM project overview

To keep AI PM beside your conversation, open the workspace panel and choose **AI PM** from **Open a surface** or the **+** menu. Press **A** while the empty surface picker is focused to open it. The panel reads the board on the conversation’s environment; you can open project briefs without leaving the chat. Close its tab to return to another surface.

For a full-page overview, open **AI PM** from the left sidebar or search for **Open AI PM** in the command palette. Choose the environment whose project board you want to read.

The overview lists open AI PM projects grouped by client, with your own business projects last. Filter by name or switch between All, Clients and Business. Choose a project to see its objective, next actions, risks and plan beside the list; in the narrow workspace panel the project replaces the list until you go back. Select an action or step to see its details and latest recorded update.

To work on one action, use its start-thread button. T3 Code opens a new thread with a drafted prompt naming the project, the action and its step; review it, then send. Threads start in the T3 project linked to the AI PM project. A project with the same name links automatically. To pick another, open the project menu under the project name, which can also create a new project with the AI PM project's name. Links you choose are saved in this browser or app.

Projects are read-only here: T3 Code does not change AI PM projects, reconcile status or merge work. A recorded completion is the board's status, not an independent verification. Use the refresh buttons to read the board or a project again. If refresh fails, previously loaded information stays visible with the error.

The selected environment needs the `aipm` CLI installed and configured for its board. If the executable is elsewhere, start that environment with `T3CODE_AIPM_EXECUTABLE` set to its absolute path. Each environment reads its own board. The browser does not read files from your computer.

## Ideas

Ideas hold concepts you started exploring but had to set aside, with the threads and files where the work happened. They appear beside the project list while no project is selected, under Active (parked or exploring), Promoted and Dropped. The filter covers ideas too.

To park an idea from a conversation, ask the agent to "park this idea". The agent writes where you left off and the next step, links the conversation, and adds any files it produced. You can also choose **New idea** and fill in the form. Threads are listed one id or thread link per line, and files and folders one absolute path per line.

Use **Status** on an idea to move it between parked, exploring and dropped, or to promote it to an existing AI PM project. Every status can move back to any other. Linked threads open in their conversation. Files open only when the environment runs on this computer; otherwise you can copy the path.

Ideas are stored in the AI PM data repository as `ideas/<id>.md`, so the `aipm idea` commands show and change the same ideas.
