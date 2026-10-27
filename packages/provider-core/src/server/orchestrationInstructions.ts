import type { ProviderInteractionMode } from "@t3tools/contracts";

/** The MCP hub entry name that connects an environment to Docs Cloud. */
export const DOCS_CLOUD_MCP_SERVER_NAME = "docs-cloud";

/** Whether a session's configured MCP servers include Docs Cloud. */
export const hasDocsCloud = (servers: ReadonlyArray<{ readonly name: string }>): boolean =>
  servers.some((server) => server.name === DOCS_CLOUD_MCP_SERVER_NAME);

// Adapters pick the Docs section from the session's own hub servers: a read-only session gets
// none even where the environment connects Docs Cloud. Project-file `docs_*` tools are in every
// session, so both sections describe them the same way.
const PROJECT_FILES_PARAGRAPH = `Markdown files under the project's \`docs/\` folder are project files: the user also sees them in the Docs panel, inside Docs Cloud, and comments on them there. \`docs_list\` lists them with their open comment counts, \`docs_read\` returns one with its open comments, \`docs_list_comments\` lists comments across files, and \`docs_open\` shows a file in the Docs panel. Change a file with your file tools. To address a comment, edit the file, then reply with \`docs_comment_reply\` saying what changed; resolve a thread with \`docs_comment_resolve\` only when asked or when you started it. \`docs_comment_create\` leaves a comment anchored to a short quote of the file's visible text, without markdown syntax.`;

const NO_CLOUD_DOCS_SECTION = `### Docs

Docs Cloud's tools are not available in this session. When the user asks for a document, plan, spec, report, or notes to keep, write it as a markdown file under \`docs/\` with your file tools, then show it with \`docs_open\`; if this session cannot write files, put it in your reply instead. The user reads these files in the Docs panel when Docs Cloud is connected in Settings → MCP servers.

${PROJECT_FILES_PARAGRAPH}`;

const CLOUD_DOCS_SECTION = `### Docs

Docs live in Docs Cloud, which the user reads, edits, and comments on in T3 Code's Docs panel. Use the \`docs-cloud\` MCP server's tools (such as \`create_doc\`, \`create_tab\`, \`edit_tab\`, \`write_tab\`, often prefixed \`mcp__docs-cloud__\` or \`docs-cloud.\`). When the user asks for a document, plan, spec, report, or notes to keep, write it there instead of pasting it into chat or writing a markdown file, unless the user asks for a file in the repo. Call \`docs_cloud_project\` (t3-code) for this T3 Code project's Docs Cloud project, which creates it on first use and is keyed by the git repository so every checkout shares it, and pass its \`key\` as \`projectKey\` to \`create_doc\`. \`move_doc\` moves a doc to another project or to none. Create the doc with its skeleton first (headings with one-line placeholders) so it opens beside the chat, then fill in each section with \`edit_tab\` or \`write_tab\`. Add a tab with \`create_tab\` for each large part. Share each doc's returned \`url\` once.

${PROJECT_FILES_PARAGRAPH} To turn project files into Docs Cloud docs when asked, use \`docs_cloud_import\`; it copies each file with its open comments, leaves the file in place, and skips files imported before.`;

// Codex truncates entries over 4,000 bytes; keep each section self-contained and below that limit.
// Codex truncates entries over 4,000 bytes; keep each section self-contained and below that limit.
export const t3CodeOrchestrationSections = (docsCloud: boolean): ReadonlyArray<string> => [
  `## T3 Code orchestration

Ordinary coding tasks need no T3 tools.

- Subagents: use your native tool when the child uses your provider, a model it offers, and no settings beyond yours, and it finishes in this turn (Claude \`Agent\` always with \`run_in_background:false\`; Codex \`spawn_agent\`, then wait). Use \`delegate_task\` for another provider's model, user-asked settings, a separate checkout (\`isolation:"worktree"\`), background work, or \`delegate_task\` by name. A native type running another provider's model counts too. Workflow only when asked.
- Call \`orchestrator_capabilities\` once per thread, before the first \`delegate_task\`. Again only after an error or a user-named provider change. Settings go in \`target.options\`. Provider or model unavailable: say so. Never switch unasked, or fall back to native tools, Workflow, or CLIs. Never make a child's checkout in the shell or in \`task\`.
- Every new delegate review or re-check is a new \`delegate_task\` (brief, findings, objections), never a \`t3_thread_send\`. Fix small review findings yourself; start no delegate for them. When told to proceed without a delegate, or to run fewer, \`task_cancel\` the extras. Start no replacement.
- Follow a running delegate's \`next\`. Do not poll it (\`task_status\`, \`sleep\`, watchers, Monitor, ScheduleWakeup). Stop a delegate run you replace or no longer need with \`task_cancel\`, never \`t3_thread_interrupt\` on a \`childThreadId\`.
- If you are a subagent or child, do the work yourself. Start no subagents unless your task says to.`,
  `- \`t3_thread_launch\` and \`create_threads\` make new top-level threads, only when the user asks for a new thread. "Subagent", "delegate", and "parallel" never mean one. Worktree thread: set \`workspaceStrategy\`; shell worktrees do not bind it, and no checkout setup in its prompt. No \`workspaceStrategy\`: project root, not your worktree.
- Given a thread id, \`t3_thread_read\` it before you answer about it.
- In your reply, a thread's first mention is its \`link\` verbatim. No \`link\`: \`[title](t3-thread://v1/<exact id>)\`. Never a plain title or bare id.
- A secret: call \`request_secret\` yourself. Pass its \`secretRef\` to a T3 tool, or use \`delivery: "file"\` for a shell command. Never ask in chat or invent one. When asked only to schedule, \`schedule_task\` without running its prompt.
- T3 tools may load late. Try the name once before you call it absent.`,
  `### Visuals and preview

- Answer data with a trend or comparison with a chart, and show any visual the user asks for here: pass its HTML to \`html_preview\`, then \`html_render\`. If the visual is a file, pass that file's HTML. A screenshot on disk or a text description does not show it. Never start a server for it. Tools a web page exposes give data only. Never use them to show results. Asked for an image to post, send, or use elsewhere: a \`.png\` file and its path, never \`html_render\`.
- Never use \`preview_*\` to verify or show your own edit, even a frontend edit or an open tab. Do not repeat preview calls from an earlier turn. Use them only when the current request asks for browser work or names a page or tab. Public pages: web fetch or search unless browser work was asked; then preview tools only, no web fetch. Close a tab you opened before you reply, unless the user asked for it or uses it.`,
  docsCloud ? CLOUD_DOCS_SECTION : NO_CLOUD_DOCS_SECTION,
  `### AI PM ideas

When the user wants to park an idea or concept for later ("park this idea"), save it with \`aipm_idea_save\`: a summary of where the work was left, the next step, and absolute paths of files it produced. It links this thread. Call \`aipm_idea_list\` first and pass an existing idea's id to update it rather than duplicate it.`,
];

export const t3CodeOrchestrationInstructions = (docsCloud: boolean): string => `

${t3CodeOrchestrationSections(docsCloud).join("\n\n")}
`;

export const T3_CODE_BROWSER_TOOL_INSTRUCTIONS = `

## T3 Code browser

When browser work was asked, \`preview_*\` is the browser you share with the user: \`preview_status\` first, then \`preview_open\` if no tab can be automated. Prefer snapshot locators over coordinates. Switch browsers only if the tools are absent or \`preview_open\` says unsupported, the user asks, or two preview calls fail on one step. Then quote the error and switch.
`;

// ACP only: some ACP agents accept the injected MCP server but never expose
// its tools, so they need the terminal transport other harnesses never use.
const T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS = `ACP fallback: if the T3 tools are absent and \`T3_ACP_MCP_NODE\` is present, call them through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" \${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`T3_ACP_MCP_ENTRYPOINT\` is unset for a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`.`;

const T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

const T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

export interface T3AcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasT3Mcp: boolean;
  readonly docsCloud: boolean;
}

/** ACP lacks system/developer fields; inject context on first prompt and tool/mode changes. */
export function t3AcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: T3AcpInstructionState;
  readonly previousState?: T3AcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (
    input.previousState?.interactionMode === input.state.interactionMode &&
    input.previousState.hasT3Mcp === input.state.hasT3Mcp &&
    input.previousState.docsCloud === input.state.docsCloud
  ) {
    return input.prompt;
  }
  const instructions = [
    input.state.interactionMode === "plan"
      ? T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS
      : T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS,
    ...(input.state.hasT3Mcp
      ? [
          T3_CODE_BROWSER_TOOL_INSTRUCTIONS.trim(),
          t3CodeOrchestrationInstructions(input.state.docsCloud).trim(),
          T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS,
        ]
      : []),
  ];
  return `<t3_code_instructions>\n${instructions.join("\n\n")}\n</t3_code_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

function prependT3OrchestrationInstructions(prompt: string, docsCloud: boolean): string {
  return `<t3_code_orchestration_instructions>${t3CodeOrchestrationInstructions(docsCloud).trim()}</t3_code_orchestration_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}

export function t3OrchestrationPromptForFirstRun(input: {
  readonly prompt: string;
  readonly runOrdinal: number;
  readonly hasT3Mcp: boolean;
  readonly docsCloud: boolean;
}): string {
  return input.runOrdinal === 1 && input.hasT3Mcp
    ? prependT3OrchestrationInstructions(input.prompt, input.docsCloud)
    : input.prompt;
}

export function t3OrchestrationSystemPrompt(
  hasT3Mcp: boolean,
  docsCloud: boolean,
): string | undefined {
  return hasT3Mcp ? t3CodeOrchestrationInstructions(docsCloud) : undefined;
}
