import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, McpServerEntry } from "@t3tools/contracts";
import {
  MCP_SERVER_PRESETS,
  MCP_SERVERS_UNSUPPORTED_MESSAGE,
  mcpOAuthRedirect,
  mcpServerAuthAction,
  mcpServerDraft,
  mcpServerDraftDropsSignIn,
  mcpServerPresetDraft,
  mcpServerStatusPresentation,
  mcpServerTransportSummary,
  mcpServerUpsertInput,
  type McpServerDraft,
  type McpServerEnvDraft,
  type McpServerPreset,
  type McpServerStatusTone,
} from "@t3tools/client-runtime/mcp-servers";
import {
  DEFAULT_DOCS_CLOUD_URL,
  docsCloudConfig,
  docsCloudUpsertInput,
} from "@t3tools/client-runtime/docs-cloud";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  CopyIcon,
  LogInIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const STATUS_BADGE_VARIANTS: Record<
  McpServerStatusTone,
  "success" | "warning" | "error" | "outline"
> = {
  success: "success",
  warning: "warning",
  error: "error",
  muted: "outline",
};

function failureMessage(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error ? failure.message : String(failure);
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  const description = failureMessage(result);
  if (description === null) return;
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

/**
 * A browser only allows a new tab during the click, so web opens it before
 * asking the server for the single-use sign-in URL. Desktop opens the system browser.
 */
async function openSignInPage(start: () => Promise<string | null>) {
  if (window.desktopBridge) {
    const url = await start();
    if (url !== null) await ensureLocalApi().shell.openExternal(url);
    return;
  }
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  const url = await start();
  if (url === null) {
    tab?.close();
  } else if (tab) {
    tab.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function McpServersSettings({
  addRequested,
  onAddHandled,
}: {
  readonly addRequested: boolean;
  readonly onAddHandled: () => void;
}) {
  const { environment, scope } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const permitted = useAtomValue(serverEnvironment.upsertMcpServer.permissionAtom(environmentId));
  const supported = environment?.serverConfig?.environment.capabilities.mcpServers === true;
  const canWrite = permitted && supported;
  const [editingState, setEditing] = useState<{ readonly entry: McpServerEntry | null } | null>(
    null,
  );
  // The palette can ask for a new server while this page is already open.
  const editing = editingState ?? (addRequested ? { entry: null } : null);
  const closeEditor = () => {
    setEditing(null);
    if (addRequested) onAddHandled();
  };

  if (environmentId === null) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          {scope.kind === "environment"
            ? `Reconnect ${scope.label} to manage its MCP servers.`
            : "Connect an environment to manage its MCP servers."}
        </p>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      {supported ? <DocsCloudSettings environmentId={environmentId} canWrite={canWrite} /> : null}
      <SettingsSection
        title="MCP servers"
        headerAction={
          supported ? (
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={!canWrite}
              onClick={() => setEditing({ entry: null })}
            >
              <PlusIcon className="size-3" />
              Add server
            </Button>
          ) : null
        }
      >
        {supported ? (
          <McpServerList
            environmentId={environmentId}
            canWrite={canWrite}
            onEdit={(entry) => setEditing({ entry })}
          />
        ) : (
          <SettingsRow title={MCP_SERVERS_UNSUPPORTED_MESSAGE} />
        )}
      </SettingsSection>
      {supported ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">
          Agents in every provider reach these servers through T3 Code, and their credentials stay
          on this environment. Changes apply to threads started afterwards.
          {permitted ? null : " Changing them needs settings access on this environment."}
        </p>
      ) : null}
      {editing !== null && canWrite ? (
        <McpServerEditor
          environmentId={environmentId}
          entry={editing.entry}
          onClose={closeEditor}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

/**
 * Docs Cloud is the `docs-cloud` hub entry: saving registers its MCP endpoint
 * with the token as a bearer header secret, so every provider gets its tools,
 * and the Docs panel embeds the same origin.
 */
function DocsCloudSettings({
  environmentId,
  canWrite,
}: {
  readonly environmentId: EnvironmentId;
  readonly canWrite: boolean;
}) {
  const servers = useEnvironmentQuery(
    serverEnvironment.mcpServersLive({ environmentId, input: {} }),
  );
  const config = servers.data ? docsCloudConfig(servers.data.servers) : null;
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsert = useAtomCommand(serverEnvironment.upsertMcpServer, {
    label: "docs cloud upsert",
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.removeMcpServer, {
    label: "docs cloud remove",
    reportFailure: false,
  });
  const shownUrl = baseUrl ?? config?.baseUrl ?? DEFAULT_DOCS_CLOUD_URL;

  const save = async () => {
    const built = docsCloudUpsertInput({ baseUrl: shownUrl, token, existing: config });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await upsert({ environmentId, input: built.input });
    setSaving(false);
    if (result._tag === "Success") {
      setToken("");
      setBaseUrl(null);
      return;
    }
    setError(failureMessage(result));
  };

  const turnOff = async () => {
    if (!config) return;
    const confirmed = await requestConfirmDialog(
      "Turn off Docs Cloud? New threads lose its tools, the Docs panel goes back to project files, and the stored token is deleted. Your docs stay in Docs Cloud.",
      { variant: "destructive" },
    );
    if (!confirmed) return;
    setSaving(true);
    const result = await remove({ environmentId, input: { id: config.serverId } });
    setSaving(false);
    if (result._tag !== "Success") setError(failureMessage(result));
  };

  return (
    <SettingsSection id="docs-cloud" title="Docs Cloud">
      <SettingsRow
        title="Docs Cloud"
        description={
          config
            ? "Agents in every provider can create and edit docs, and the Docs panel shows them beside the chat."
            : "Off. Connect your hosted Docs Cloud so agents write docs there and the Docs panel shows them."
        }
        status={
          config ? (
            <Badge variant={config.enabled ? "success" : "outline"}>
              {config.enabled ? "Connected" : "Disabled"}
            </Badge>
          ) : null
        }
      />
      <form
        className="space-y-3 px-4 pb-4 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={!canWrite || saving} className="space-y-3">
          <Field label="URL" htmlFor="docs-cloud-url">
            <Input
              id="docs-cloud-url"
              autoComplete="off"
              value={shownUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>
          <Field
            label="API token"
            hint={config ? "stored; paste a new one to replace it" : "from Docs Cloud Settings"}
            htmlFor="docs-cloud-token"
          >
            <Input
              id="docs-cloud-token"
              type="password"
              autoComplete="off"
              placeholder={config ? "••••••" : "dct_…"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {config ? (
              <Button type="button" size="sm" variant="ghost-destructive" onClick={turnOff}>
                Turn off
              </Button>
            ) : null}
            <Button type="submit" size="sm">
              {config ? "Save" : "Connect"}
            </Button>
          </div>
        </fieldset>
      </form>
    </SettingsSection>
  );
}

function McpServerList({
  environmentId,
  canWrite,
  onEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly canWrite: boolean;
  readonly onEdit: (entry: McpServerEntry) => void;
}) {
  const servers = useEnvironmentQuery(
    serverEnvironment.mcpServersLive({ environmentId, input: {} }),
  );
  if (servers.error !== null) return <SettingsRow title={servers.error} />;
  if (servers.data === null) return <SettingsRow title="Loading servers…" />;
  if (servers.data.servers.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlugIcon />
          </EmptyMedia>
          <EmptyTitle>No MCP servers yet</EmptyTitle>
          <EmptyDescription>
            Add a server by URL or command, and agents can use its tools in new threads.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return servers.data.servers.map((entry) => (
    <McpServerRow
      key={entry.id}
      environmentId={environmentId}
      entry={entry}
      canWrite={canWrite}
      onEdit={() => onEdit(entry)}
    />
  ));
}

function McpServerRow({
  environmentId,
  entry,
  canWrite,
  onEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: McpServerEntry;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const setEnabled = useAtomCommand(serverEnvironment.setMcpServerEnabled, {
    label: "mcp server enabled",
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.removeMcpServer, {
    label: "mcp server remove",
    reportFailure: false,
  });
  const startSignIn = useAtomCommand(serverEnvironment.startMcpServerSignIn, {
    label: "mcp server sign in",
    reportFailure: false,
  });
  const signOut = useAtomCommand(serverEnvironment.signOutMcpServer, {
    label: "mcp server sign out",
    reportFailure: false,
  });
  const status = mcpServerStatusPresentation(entry.status);
  const authAction = mcpServerAuthAction(entry);
  const input = { id: entry.id };

  const run = async (title: string, action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    if (busy) return;
    setBusy(true);
    const result = await action();
    setBusy(false);
    reportFailure(title, result);
  };
  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    await openSignInPage(async () => {
      const result = await startSignIn({ environmentId, input });
      if (result._tag === "Success") return result.value.authorizationUrl;
      reportFailure(`Could not start sign-in to ${entry.name}`, result);
      return null;
    }).catch(() => {
      toastManager.add(
        stackedThreadToast({ type: "error", title: `Could not open sign-in for ${entry.name}` }),
      );
    });
    setBusy(false);
  };
  const confirmRemove = async () => {
    const confirmed = await requestConfirmDialog(
      `Remove ${entry.name}? Its stored credentials are deleted, and new threads stop seeing its tools.`,
      { variant: "destructive" },
    );
    if (confirmed) {
      await run(`Could not remove ${entry.name}`, () => remove({ environmentId, input }));
    }
  };

  return (
    <SettingsRow
      title={entry.name}
      description={
        <span className="block truncate font-mono text-xs">{mcpServerTransportSummary(entry)}</span>
      }
      status={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANTS[status.tone]}>{status.label}</Badge>
          {status.detail ? (
            <span className={status.tone === "error" ? "text-destructive" : undefined}>
              {status.detail}
            </span>
          ) : null}
        </div>
      }
      control={
        <div className="flex items-center gap-2">
          {authAction === "sign-in" && entry.enabled ? (
            <Button size="xs" variant="outline" disabled={busy || !canWrite} onClick={signIn}>
              Sign in
            </Button>
          ) : null}
          <Switch
            checked={entry.enabled}
            disabled={busy || !canWrite}
            aria-label={`Enable ${entry.name}`}
            onCheckedChange={(enabled) =>
              void run(`Could not update ${entry.name}`, () =>
                setEnabled({ environmentId, input: { id: entry.id, enabled } }),
              )
            }
          />
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || !canWrite}
                  aria-label={`Actions for ${entry.name}`}
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={onEdit}>
                <PencilIcon />
                Edit
              </MenuItem>
              {authAction === "sign-in" ? (
                <MenuItem onClick={signIn}>
                  <LogInIcon />
                  Sign in
                </MenuItem>
              ) : authAction === "sign-out" ? (
                <>
                  <MenuItem onClick={signIn}>
                    <LogInIcon />
                    Sign in again
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      void run(`Could not sign out of ${entry.name}`, () =>
                        signOut({ environmentId, input }),
                      )
                    }
                  >
                    <LogOutIcon />
                    Sign out
                  </MenuItem>
                </>
              ) : null}
              <MenuSeparator />
              <MenuItem onClick={() => void confirmRemove()}>
                <Trash2Icon />
                Remove
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      }
    />
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly htmlFor?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-baseline justify-between" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint ? (
          <span className="font-normal text-2xs text-muted-foreground/80">{hint}</span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}

function McpServerEditor({
  environmentId,
  entry,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: McpServerEntry | null;
  readonly onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      {/* The form owns the draft so a keystroke re-renders it, not the dialog chrome. */}
      <DialogPopup className="max-w-xl">
        <McpServerEditorForm
          environmentId={environmentId}
          entry={entry}
          saving={saving}
          onSavingChange={setSaving}
          onClose={onClose}
        />
      </DialogPopup>
    </Dialog>
  );
}

function McpServerEditorForm({
  environmentId,
  entry,
  saving,
  onSavingChange,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: McpServerEntry | null;
  readonly saving: boolean;
  readonly onSavingChange: (saving: boolean) => void;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => mcpServerDraft(entry));
  const [preset, setPreset] = useState<McpServerPreset | null>(null);
  const servers = useEnvironmentQuery(
    serverEnvironment.mcpServersLive({ environmentId, input: {} }),
  );
  const [error, setError] = useState<string | null>(null);
  const upsert = useAtomCommand(serverEnvironment.upsertMcpServer, {
    label: "mcp server upsert",
    reportFailure: false,
  });
  const redirect = mcpOAuthRedirect(useEnvironmentHttpBaseUrl(environmentId));
  const update = (patch: Partial<McpServerDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const updateEnv = (index: number, patch: Partial<McpServerEnvDraft>) =>
    setDraft((current) => ({
      ...current,
      env: current.env.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }));
  const dropsSignIn = mcpServerDraftDropsSignIn(entry, draft);

  const submit = async () => {
    const built = mcpServerUpsertInput(draft, redirect?.uri ?? null);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    onSavingChange(true);
    const result = await upsert({ environmentId, input: built.input });
    onSavingChange(false);
    if (result._tag === "Success") {
      onClose();
      return;
    }
    setError(failureMessage(result));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{entry ? `Edit ${entry.name}` : "Add MCP server"}</DialogTitle>
        <DialogDescription>
          Agents see its tools as mcp__{draft.name.trim() || "name"}__tool in threads started after
          you save.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <fieldset disabled={saving} className="space-y-5">
          {entry === null ? (
            <div className="space-y-1.5">
              <Label>Start from</Label>
              <div className="flex flex-wrap gap-1.5">
                {MCP_SERVER_PRESETS.map((option) => (
                  <Button
                    key={option.name}
                    size="xs"
                    variant={preset === option ? "secondary" : "outline"}
                    aria-pressed={preset === option}
                    onClick={() => {
                      setPreset(option);
                      setDraft(
                        mcpServerPresetDraft(
                          option,
                          new Set(servers.data?.servers.map((server) => server.name)),
                        ),
                      );
                      setError(null);
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {preset?.note ? <p className="text-xs text-muted-foreground">{preset.note}</p> : null}
            </div>
          ) : null}

          <Field label="Name" hint="lowercase, digits, - and _" htmlFor="mcp-server-name">
            <Input
              id="mcp-server-name"
              placeholder="e.g. notion"
              autoComplete="off"
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>

          <div className="flex items-center justify-between gap-2">
            <Label>Connects by</Label>
            <ToggleGroup
              aria-label="Transport"
              value={[draft.transport]}
              onValueChange={(values) => {
                const transport = values[0];
                if (transport === "http" || transport === "stdio") update({ transport });
              }}
            >
              <Toggle value="http">URL</Toggle>
              <Toggle value="stdio">Command</Toggle>
            </ToggleGroup>
          </div>

          {draft.transport === "http" ? (
            <>
              <Field label="URL" htmlFor="mcp-server-url">
                <Input
                  id="mcp-server-url"
                  placeholder="https://mcp.example.com/mcp"
                  autoComplete="off"
                  value={draft.url}
                  onChange={(event) => update({ url: event.target.value })}
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <Label>Sign-in</Label>
                <ToggleGroup
                  aria-label="Authentication"
                  value={[draft.auth]}
                  onValueChange={(values) => {
                    const auth = values[0];
                    if (auth === "none" || auth === "header" || auth === "oauth") update({ auth });
                  }}
                >
                  <Toggle value="none">None</Toggle>
                  <Toggle value="header">Header</Toggle>
                  <Toggle value="oauth">OAuth</Toggle>
                </ToggleGroup>
              </div>
              {draft.auth === "header" ? (
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                  <Field label="Header" htmlFor="mcp-server-header">
                    <Input
                      id="mcp-server-header"
                      autoComplete="off"
                      value={draft.header}
                      onChange={(event) => update({ header: event.target.value })}
                    />
                  </Field>
                  <Field label="Value" htmlFor="mcp-server-header-value">
                    <Input
                      id="mcp-server-header-value"
                      type="password"
                      autoComplete="off"
                      placeholder={draft.headerStored ? "Saved. Leave blank to keep." : "Bearer …"}
                      value={draft.headerValue}
                      onChange={(event) => update({ headerValue: event.target.value })}
                    />
                  </Field>
                </div>
              ) : null}
              {draft.auth === "oauth" ? (
                <OAuthClientFields draft={draft} redirect={redirect} update={update} />
              ) : null}
            </>
          ) : (
            <>
              <Field label="Command" htmlFor="mcp-server-command">
                <Input
                  id="mcp-server-command"
                  placeholder="e.g. npx"
                  autoComplete="off"
                  value={draft.command}
                  onChange={(event) => update({ command: event.target.value })}
                />
              </Field>
              <Field label="Arguments" hint="one per line" htmlFor="mcp-server-args">
                <Textarea
                  id="mcp-server-args"
                  rows={3}
                  value={draft.args}
                  onChange={(event) => update({ args: event.target.value })}
                />
              </Field>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Environment variables</Label>
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    onClick={() =>
                      update({
                        env: [...draft.env, { key: "", value: "", secret: false, stored: false }],
                      })
                    }
                  >
                    <PlusIcon className="size-3" />
                    Add variable
                  </Button>
                </div>
                {draft.env.map((row, index) => (
                  // Rows have no identity until named, and only this form reorders them.
                  // oxlint-disable-next-line react/no-array-index-key
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      aria-label="Variable name"
                      placeholder="NAME"
                      autoComplete="off"
                      size="sm"
                      value={row.key}
                      onChange={(event) => updateEnv(index, { key: event.target.value })}
                    />
                    <Input
                      aria-label={`Value of ${row.key || "variable"}`}
                      type={row.secret ? "password" : "text"}
                      autoComplete="off"
                      size="sm"
                      placeholder={row.stored ? "Saved. Leave blank to keep." : "value"}
                      value={row.value}
                      onChange={(event) => updateEnv(index, { value: event.target.value })}
                    />
                    <Label className="shrink-0">
                      <Checkbox
                        checked={row.secret}
                        disabled={row.stored}
                        onCheckedChange={(secret) => updateEnv(index, { secret })}
                      />
                      Secret
                    </Label>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${row.key || "variable"}`}
                      onClick={() =>
                        update({ env: draft.env.filter((_, rowIndex) => rowIndex !== index) })
                      }
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Secret values are stored on this environment and never shown again.
                </p>
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="mcp-server-enabled">Enabled</Label>
            <Switch
              id="mcp-server-enabled"
              checked={draft.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </div>

          {dropsSignIn ? (
            <p className="text-xs text-warning-foreground">
              Changing the URL or client signs this server out. Sign in again after saving.
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" size="sm" disabled={saving} />}>
          Cancel
        </DialogClose>
        <Button size="sm" disabled={saving} onClick={() => void submit()}>
          {entry ? "Save" : "Add server"}
        </Button>
      </DialogFooter>
    </>
  );
}

function OAuthClientFields({
  draft,
  redirect,
  update,
}: {
  readonly draft: McpServerDraft;
  readonly redirect: ReturnType<typeof mcpOAuthRedirect>;
  readonly update: (patch: Partial<McpServerDraft>) => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        After saving, use Sign in on the server's row. T3 Code registers itself with the provider
        automatically.
      </p>
      <Label>
        <Checkbox
          checked={draft.registeredClient}
          onCheckedChange={(registeredClient) => update({ registeredClient })}
        />
        Use a client I registered with the provider
      </Label>
      {draft.registeredClient ? (
        <div className="space-y-3">
          <Field label="Client ID" htmlFor="mcp-server-client-id">
            <Input
              id="mcp-server-client-id"
              autoComplete="off"
              value={draft.clientId}
              onChange={(event) => update({ clientId: event.target.value })}
            />
          </Field>
          <Field label="Client secret" hint="optional" htmlFor="mcp-server-client-secret">
            <Input
              id="mcp-server-client-secret"
              type="password"
              autoComplete="off"
              placeholder={draft.clientSecretStored ? "Saved. Leave blank to keep." : undefined}
              value={draft.clientSecret}
              onChange={(event) => update({ clientSecret: event.target.value })}
            />
          </Field>
          <Field label="Redirect URI" hint="register this exact value">
            {redirect ? (
              <div className="flex items-center gap-2">
                <Input readOnly size="sm" aria-label="Redirect URI" value={redirect.uri} />
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Copy redirect URI"
                  onClick={() => copyToClipboard(redirect.uri)}
                >
                  <CopyIcon className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-destructive">This environment's address is unknown.</p>
            )}
          </Field>
          {isCopied ? <p className="text-xs text-muted-foreground">Copied.</p> : null}
          {redirect?.note ? <p className="text-xs text-muted-foreground">{redirect.note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
