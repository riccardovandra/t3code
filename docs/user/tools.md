# Skills and MCP servers

**Settings → Tools** controls the skills agents load on an environment. Pick a project in the
settings crumb to change them for that project only. Changes apply when an agent session next
starts; use **Restart agent session** in the command palette to pick them up in an open thread.

## Skills

The **Skills** tab lists every skill the environment's agents find, grouped by where it lives: the
selected project, your personal folders (such as `~/.agents/skills` and `~/.claude/skills`), and
plugins. A skill is listed once even when several folders or agents have it.

Turning a skill off removes it from the composer's skill menu and hides it from Claude, Codex and
OpenCode 1.x sessions. Cursor, Grok, Antigravity, Pi and OpenCode 2 have no way to hide one skill,
so they may still use it on their own. A skill switched off in the agent's own settings shows as
off and can't be turned on here.

With a project selected, a switch overrides the environment for that project only: you can turn a
skill off for one project, or back on where the environment has it off.

A **Conflict** mark means two different skills share a name. The switch turns both of them on or
off, so remove or rename the copy you don't want; the warning button beside the search lists every
conflict. Opening a skill shows the files in its folder; a skill marked **Includes
scripts** has files an agent could run.

### Adding skills

**Add skills** installs skills from a GitHub `owner/repo`, a git URL, or a folder on the
environment, the same way `npx skills add` does. T3 Code lists the skills in the source first, so
you can pick some and check which include scripts. Install only sources you trust.

With a project selected, skills go into the project's `.agents/skills` folder and its
`skills-lock.json`, which you can commit for your team. Otherwise they go into `~/.agents/skills`
for every project. Agents that only read their own folder, such as Claude, get a link to the skill.

With **All environments** selected, the list shows the skills on every connected environment. Each
row shows the machines that have the skill, or one mark when they all do, and a skill's page can
**Copy to** the environments missing it. A copy reinstalls from the skill's source when it has one
the other machine can reach, so it can be updated there too, and otherwise copies the files.

Skills installed this way, here or with `npx skills` in a terminal, are grouped by where they came
from, with one switch for the group. Their page has **Update**, which installs the latest version
from the same source, and **Remove**. Other skills in your own skill folders, such as
`~/.claude/skills` or a project's `.agents/skills`, can be removed from a skill's page too; skills
from plugins and the ones agents ship with can only be switched off. Installing runs the open-source
[`skills`](https://github.com/vercel-labs/skills) installer built into T3 Code, with its telemetry
off. Installing, updating and removing skills needs permission to manage providers.

## MCP servers

MCP servers are managed in **Settings → MCP Servers**; the **MCP servers** tab here opens that
page. See [MCP servers](./mcp-servers.md).
