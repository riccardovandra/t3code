import type { TerminalRunCommandResult } from "@t3tools/contracts";

// Errors usually sit at the end, so a long output keeps its last lines.
const MAX_REPORT_LINES = 200;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  "g",
);

function fenced(text: string, language: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function cleanOutput(text: string): { readonly text: string; readonly omittedLines: number } {
  const lines = text.replace(ANSI_ESCAPE, "").replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const omittedLines = Math.max(0, lines.length - MAX_REPORT_LINES);
  return { text: lines.slice(omittedLines).join("\n"), omittedLines };
}

function outcome(result: TerminalRunCommandResult): string {
  if (result.timedOut) return "It was stopped after 2 minutes without finishing.";
  if (result.exitCode === null) return "It was stopped before it could exit.";
  return result.exitCode === 0 ? "It succeeded." : `It failed with exit code ${result.exitCode}.`;
}

/** The composer text that reports a chat code block's run back to the agent. */
export function formatChatCommandReport(command: string, result: TerminalRunCommandResult): string {
  const sections = [`I ran this command. ${outcome(result)}`, fenced(command, "sh")];
  const streams = [
    { label: "Output", ...cleanOutput(result.stdout) },
    { label: "Errors", ...cleanOutput(result.stderr) },
  ].filter((stream) => stream.text.length > 0);
  if (streams.length === 0) sections.push("It printed nothing.");
  for (const stream of streams) {
    const note =
      stream.omittedLines > 0
        ? ` (last ${MAX_REPORT_LINES} lines, ${stream.omittedLines} cut)`
        : "";
    sections.push(`${stream.label}${note}:`, fenced(stream.text, "text"));
  }
  if (result.truncated) sections.push("The output was over 64 KB, so only its end was kept.");
  return sections.join("\n\n");
}
