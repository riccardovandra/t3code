import { ENV_VARIABLE_NAME_PATTERN } from "@t3tools/contracts";

export const DEFAULT_SECRET_ENV_FILE = ".env";

const SECRET_COMMAND_PATTERN = /^\/secret(?:\s+([^\n]*))?$/i;

/**
 * `/secret OPENAI_API_KEY, RESEND_API_KEY` names the rows the form opens with.
 * Returns null when the text is not the command; tokens that are not valid
 * variable names are dropped rather than failing the whole command.
 */
export function parseSecretCommand(text: string): ReadonlyArray<string> | null {
  const match = SECRET_COMMAND_PATTERN.exec(text.trim());
  if (match === null) return null;
  const names = (match[1] ?? "")
    .split(/[\s,]+/)
    .filter((token) => ENV_VARIABLE_NAME_PATTERN.test(token));
  return [...new Set(names)];
}

const ENV_LINE_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/** Reads pasted `KEY=value` lines, the shape people copy out of a dashboard or another .env. */
export function parseEnvBlock(
  text: string,
): ReadonlyArray<{ readonly name: string; readonly value: string }> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE_PATTERN.exec(line);
    if (match === null) continue;
    const name = match[1]!;
    let value = match[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === "`") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    if (value !== "") entries.set(name, value);
  }
  return [...entries].map(([name, value]) => ({ name, value }));
}

/** Tells the agent which names now exist, never their values. */
export function secretSavedDraft(names: ReadonlyArray<string>, relativePath: string): string {
  return `I added ${names.join(", ")} to ${relativePath}. Read ${
    names.length === 1 ? "it" : "them"
  } from the environment and don't print the values.`;
}
