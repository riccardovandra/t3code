# MCP servers

Add an MCP server to an environment once, and agents in every provider can use
its tools. Codex, Claude, Cursor, OpenCode and the others all reach it through
T3 Code, so you do not configure it per provider or per account. Its
credentials stay on the environment.

## Add a server

Open **Settings → MCP Servers** and choose **Add server**, or run **Add MCP
server** from the command palette.

- **URL**: paste the server's MCP endpoint, such as
  `https://mcp.notion.com/mcp`. For sign-in, choose **None**, **Header** (an API
  key sent as a header, such as `Authorization: Bearer …`), or **OAuth**.
- **Command**: enter the command that starts a local server, one argument per
  line, and any environment variables. Mark API keys as **Secret**. T3 Code runs
  the command on the environment's machine. Command servers are added from web
  or desktop.

To skip typing, pick a server under **Start from**, such as Gmail, Google
Drive, Slack, Apify, Notion or GitHub, and the form fills in its name, URL and
sign-in method. Gmail, Google Drive, Google Calendar and Slack do not let T3
Code register itself, so they need a client you register with the provider (see
[Sign in](#sign-in)).

To use two accounts of the same service, such as a work and a personal Gmail
or two Slack workspaces, add the server once per account. Picking a preset
again names the copy `gmail-2`, and each copy signs in separately. Google asks
which account to use every time. For Slack, the app must be installable in each
workspace you add.

Agents see the tools as `mcp__<name>__<tool>`, so pick a short name.

Changes apply to threads started after you save. Threads that are already
running keep the servers they started with.

## Sign in

For an OAuth server, choose **Sign in** on its row. The provider's sign-in page
opens in a new tab, or in the system browser on mobile. Approve access, then
close the tab. The row changes to **Connected** once a thread uses it.

The sign-in link works once and expires after 10 minutes. If it expires, choose
**Sign in** again.

Some providers do not let T3 Code register itself, or reject `localhost`
addresses. For those, register an app with the provider yourself, turn on
**Use a client I registered with the provider** when editing the server, and
enter its client ID and secret. Register the **Redirect URI** shown there,
exactly as shown. If it starts with `localhost`, open T3 Code on its Tailscale
or T3 Connect address first, so the provider gets an address it accepts.

## Needs sign-in

A server shows **Needs sign-in** before its first sign-in and after its access
expires or is revoked. Agents that call it get an error asking you to sign in.
Choose **Sign in**. Threads that already have the server pick up the new sign-in
without restarting.

Changing a server's URL or client ID signs it out. Sign in again after saving.

**Sign out** deletes the stored sign-in. **Remove** deletes the server and its
stored credentials.

## Who can change servers

Viewing servers needs ordinary access to the environment. Adding, editing,
signing in and removing need settings access. A device without it sees a
read-only list.
