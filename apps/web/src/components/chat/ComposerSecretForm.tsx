import { ENV_VARIABLE_NAME_PATTERN, type EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { ClipboardPasteIcon, KeyRoundIcon, PlusIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { DEFAULT_SECRET_ENV_FILE, parseEnvBlock, secretSavedDraft } from "../../secretCommand";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ComposerBanner } from "./ComposerBanner";

interface SecretRow {
  readonly id: string;
  /** The name a /secret command asked for, so a renamed or removed row still answers it. */
  readonly origin: string | null;
  readonly name: string;
  readonly value: string;
}

let nextRowId = 0;
const newRow = (name = "", value = ""): SecretRow => ({
  id: `row:${nextRowId++}`,
  origin: null,
  name,
  value,
});

/**
 * Names asked for by /secret show as rows until the user edits one, so an
 * agent's button can add names to a form that already holds typed values.
 */
function visibleSecretRows(
  rows: ReadonlyArray<SecretRow>,
  requested: ReadonlyArray<string>,
  dismissed: ReadonlySet<string>,
): ReadonlyArray<SecretRow> {
  const claimed = new Set(rows.map((row) => row.origin ?? row.name));
  const pending = requested
    .filter((name) => !claimed.has(name) && !dismissed.has(name))
    .map((name) => ({ id: `requested:${name}`, origin: name, name, value: "" }));
  const visible = [...rows, ...pending];
  return visible.length > 0 ? visible : [{ id: "blank", origin: null, name: "", value: "" }];
}

/** Masked text rather than a password field: browsers offer to save any submitted password. */
const MASKED_INPUT_PROPS = {
  type: "text",
  className: "[-webkit-text-security:disc]",
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
} as const;

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "Could not save the secrets.";
}

/**
 * The /secret form. Values live only in this component's state and go to the
 * server's .env writer; the thread sees at most the names, and only if the
 * user sends the draft this leaves in the composer.
 */
export function ComposerSecretForm(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly names: ReadonlyArray<string>;
  readonly onClose: () => void;
  readonly onSaved: (draft: string) => void;
}) {
  const [rows, setRows] = useState<ReadonlyArray<SecretRow>>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [relativePath, setRelativePath] = useState(DEFAULT_SECRET_ENV_FILE);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [tellAgent, setTellAgent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permitted = useAtomValue(
    projectEnvironment.setEnvVariables.permissionAtom(props.environmentId),
  );
  const save = useAtomCommand(projectEnvironment.setEnvVariables, {
    label: "save secrets to env file",
    // A failure carries the request, values included; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });

  const visibleRows = visibleSecretRows(rows, props.names, dismissed);

  const updateRow = (index: number, patch: Partial<Pick<SecretRow, "name" | "value">>) =>
    setRows(visibleRows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const removeRow = (index: number) => {
    const origin = visibleRows[index]?.origin;
    if (origin != null) setDismissed(new Set([...dismissed, origin]));
    setRows(visibleRows.filter((_, at) => at !== index));
  };

  const applyPasted = () => {
    const entries = parseEnvBlock(pasted);
    if (entries.length === 0) {
      setError("No KEY=value lines found.");
      return;
    }
    const byName = new Map(entries.map((entry) => [entry.name, entry.value]));
    const kept = visibleRows
      .filter((row) => row.name !== "" || row.value !== "")
      .map((row) => (byName.has(row.name) ? { ...row, value: byName.get(row.name)! } : row));
    const present = new Set(kept.map((row) => row.name));
    setRows([
      ...kept,
      ...entries
        .filter((entry) => !present.has(entry.name))
        .map((entry) => newRow(entry.name, entry.value)),
    ]);
    setPasted("");
    setPasting(false);
    setError(null);
  };

  const filled = visibleRows.filter((row) => row.name.trim() !== "" || row.value !== "");
  const blocker =
    props.cwd === null
      ? "This thread has no folder to save into."
      : !permitted
        ? "This connection can't write files on this environment."
        : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || props.cwd === null || blocker !== null || filled.length === 0) return;
    const invalidName = filled.find((row) => !ENV_VARIABLE_NAME_PATTERN.test(row.name.trim()));
    if (invalidName !== undefined) {
      setError(
        `${invalidName.name.trim() || "A key"} is not a valid name. Use letters, digits and underscores.`,
      );
      return;
    }
    const missingValue = filled.find((row) => row.value === "");
    if (missingValue !== undefined) {
      setError(`Enter a value for ${missingValue.name.trim()}.`);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await save({
      environmentId: props.environmentId,
      input: {
        cwd: props.cwd,
        relativePath: relativePath.trim() || DEFAULT_SECRET_ENV_FILE,
        variables: filled.map((row) => ({ name: row.name.trim(), value: row.value })),
      },
    }).finally(() => setSaving(false));
    if (result._tag !== "Success") {
      if (!isAtomCommandInterrupted(result)) {
        setError(failureMessage(squashAtomCommandFailure(result)));
      }
      return;
    }
    const names = result.value.variables.map((variable) => variable.name);
    toastManager.add(
      stackedThreadToast({
        type: result.value.gitIgnored === false ? "warning" : "success",
        title: `Saved ${names.length === 1 ? names[0] : `${names.length} secrets`} to ${result.value.relativePath}`,
        description:
          result.value.gitIgnored === false
            ? `${result.value.relativePath} is not in .gitignore, so git could commit it.`
            : "The values were not shared with the agent.",
      }),
    );
    if (tellAgent) props.onSaved(secretSavedDraft(names, result.value.relativePath));
    props.onClose();
  };

  const firstEmptyValue = visibleRows.findIndex((row) => row.value === "");

  return (
    <ComposerBanner.Root variant="info" density="spacious" data-chat-composer-secret-form="true">
      <form
        className="flex min-w-0 flex-col gap-3"
        autoComplete="off"
        onSubmit={(event) => void onSubmit(event)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <ComposerBanner.Row>
          <ComposerBanner.Icon>
            <KeyRoundIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content>
            <span className="font-medium text-foreground">Add secrets</span>
            <ComposerBanner.Separator />
            <span className="truncate text-muted-foreground">
              Saved to a file in this thread's folder, never sent to the agent
            </span>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            <ComposerBanner.Dismiss aria-label="Close" onClick={props.onClose} />
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        <ComposerBanner.Body className="flex flex-col gap-2">
          {visibleRows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
              <Input
                size="sm"
                aria-label="Key name"
                placeholder="KEY_NAME"
                autoComplete="off"
                spellCheck={false}
                autoFocus={index === 0 && row.name === ""}
                value={row.name}
                disabled={saving}
                onChange={(event) =>
                  updateRow(index, { name: event.currentTarget.value.toUpperCase() })
                }
              />
              <Input
                {...MASKED_INPUT_PROPS}
                size="sm"
                aria-label={row.name ? `Value for ${row.name}` : "Value"}
                placeholder="Paste value"
                autoFocus={row.name !== "" && index === firstEmptyValue}
                value={row.value}
                disabled={saving}
                onChange={(event) => updateRow(index, { value: event.currentTarget.value })}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost-muted"
                aria-label={`Remove ${row.name || "row"}`}
                disabled={saving}
                onClick={() => removeRow(index)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
          {pasting ? (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Paste KEY=value lines"
                placeholder={"OPENAI_API_KEY=sk-...\nRESEND_API_KEY=re_..."}
                rows={3}
                spellCheck={false}
                autoFocus
                value={pasted}
                onChange={(event) => setPasted(event.currentTarget.value)}
              />
              <div className="flex gap-2">
                <Button type="button" size="xs" variant="outline" onClick={applyPasted}>
                  Split into rows
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  onClick={() => {
                    setPasting(false);
                    setPasted("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              disabled={saving}
              onClick={() => setRows([...visibleRows, newRow()])}
            >
              <PlusIcon />
              Add key
            </Button>
            {pasting ? null : (
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
                disabled={saving}
                onClick={() => setPasting(true)}
              >
                <ClipboardPasteIcon />
                Paste .env lines
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                File
                <Input
                  size="sm"
                  aria-label="File to save into"
                  spellCheck={false}
                  value={relativePath}
                  disabled={saving}
                  onChange={(event) => setRelativePath(event.currentTarget.value)}
                />
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={tellAgent}
                  onCheckedChange={(checked) => setTellAgent(checked === true)}
                />
                Tell the agent the key names
              </label>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={saving || blocker !== null || filled.length === 0}
            >
              {filled.length > 1 ? `Save ${filled.length} secrets` : "Save secret"}
            </Button>
          </div>
          {error !== null || blocker !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {error ?? blocker}
            </p>
          ) : null}
        </ComposerBanner.Body>
      </form>
    </ComposerBanner.Root>
  );
}
