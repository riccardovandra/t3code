import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AiPmIdea,
  AiPmIdeaStatus,
  AiPmIdeaThread,
  AiPmProjectSummary,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { ChevronDownIcon, FileIcon, LightbulbIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useRemoteOpenResolution } from "../../remoteOpen";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { MarkdownThreadLink } from "../chat/MarkdownThreadLink";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { MiddleTruncate } from "../ui/middle-truncate";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";

const STATUS_LABEL: Record<AiPmIdeaStatus, string> = {
  parked: "Parked",
  exploring: "Exploring",
  promoted: "Promoted",
  dropped: "Dropped",
};
const STATUS_BADGE = {
  parked: "secondary",
  exploring: "info",
  promoted: "success",
  dropped: "outline",
} as const satisfies Record<AiPmIdeaStatus, string>;

const VIEWS = [
  { id: "active", label: "Active", statuses: ["parked", "exploring"] },
  { id: "promoted", label: "Promoted", statuses: ["promoted"] },
  { id: "dropped", label: "Dropped", statuses: ["dropped"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  statuses: ReadonlyArray<AiPmIdeaStatus>;
}>;
type View = (typeof VIEWS)[number]["id"];

const reportFailure = (title: string, error: unknown) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : String(error),
    }),
  );

export function AiPmIdeas({
  environmentId,
  filter,
  projects,
  onSelectProject,
}: {
  readonly environmentId: EnvironmentId;
  readonly filter: string;
  readonly projects: ReadonlyArray<AiPmProjectSummary>;
  readonly onSelectProject: (id: string) => void;
}) {
  const ideas = useEnvironmentQuery(serverEnvironment.aiPmIdeas({ environmentId, input: {} }));
  const canWrite = useAtomValue(serverEnvironment.saveAiPmIdea.permissionAtom(environmentId));
  const [view, setView] = useState<View>("active");
  const [editing, setEditing] = useState<AiPmIdea | "new" | null>(null);
  const statuses: ReadonlyArray<AiPmIdeaStatus> =
    VIEWS.find((entry) => entry.id === view)?.statuses ?? [];
  const all = ideas.data?.ideas ?? [];
  const visible = all.filter(
    (idea) =>
      statuses.includes(idea.status) &&
      `${idea.title} ${idea.summary} ${idea.next}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="space-y-4" aria-label="Ideas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <LightbulbIcon className="size-4 text-muted-foreground" /> Ideas
          </h2>
          <p className="text-sm text-muted-foreground">
            Concepts you parked, with the chats and files where the work happened.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {VIEWS.map((entry) => (
            <Button
              key={entry.id}
              size="sm"
              variant={entry.id === view ? "secondary" : "ghost"}
              aria-pressed={entry.id === view}
              onClick={() => setView(entry.id)}
            >
              {entry.label} ·{" "}
              {
                all.filter((idea) =>
                  (entry.statuses as ReadonlyArray<string>).includes(idea.status),
                ).length
              }
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite}
            onClick={() => setEditing("new")}
          >
            <PlusIcon className="size-4" /> New idea
          </Button>
        </div>
      </div>
      {ideas.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Couldn’t read ideas: {ideas.error}
        </p>
      ) : null}
      {ideas.isPending && !ideas.data ? <p role="status">Reading ideas…</p> : null}
      <div className="grid min-w-0 gap-3 @4xl/ai-pm:grid-cols-2">
        {visible.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            environmentId={environmentId}
            projects={projects}
            canWrite={canWrite}
            onEdit={() => setEditing(idea)}
            onChanged={ideas.refresh}
            onSelectProject={onSelectProject}
          />
        ))}
      </div>
      {ideas.data && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {all.length === 0
            ? "No ideas yet. Ask an agent to “park this idea” at the end of a chat, or add one here."
            : "No ideas in this view."}
        </p>
      ) : null}
      {editing !== null ? (
        <IdeaDialog
          key={editing === "new" ? "new" : editing.id}
          environmentId={environmentId}
          idea={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            ideas.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function IdeaCard({
  idea,
  environmentId,
  projects,
  canWrite,
  onEdit,
  onChanged,
  onSelectProject,
}: {
  readonly idea: AiPmIdea;
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<AiPmProjectSummary>;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
  readonly onChanged: () => void;
  readonly onSelectProject: (id: string) => void;
}) {
  const setStatus = useAtomCommand(serverEnvironment.setAiPmIdeaStatus, {
    label: "AI PM idea status",
  });
  const [busy, setBusy] = useState(false);
  const project = idea.project ? projects.find((entry) => entry.id === idea.project) : undefined;
  const changeStatus = async (status: AiPmIdeaStatus, projectId?: string | null) => {
    if (busy) return;
    setBusy(true);
    const result = await setStatus({
      environmentId,
      input: { id: idea.id, status, ...(projectId === undefined ? {} : { projectId }) },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not change the idea’s status", squashAtomCommandFailure(result));
      return;
    }
    onChanged();
  };
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card/30 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Updated {idea.updated}</span>
        <Badge variant={STATUS_BADGE[idea.status]}>
          {STATUS_LABEL[idea.status]}
          {idea.status === "promoted" && idea.project ? ` → ${project?.name ?? idea.project}` : ""}
        </Badge>
      </div>
      <h3 className="text-base font-medium">{idea.title}</h3>
      {idea.summary ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Where you left off: </span>
          {idea.summary}
        </p>
      ) : null}
      {idea.next ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          <span className="font-medium">Next: </span>
          {idea.next}
        </p>
      ) : null}
      {idea.threads.length ? (
        <ul className="space-y-1 text-sm" aria-label="Linked threads">
          {idea.threads.map((thread) => (
            <li key={thread.id} className="min-w-0 truncate">
              <MarkdownThreadLink
                environmentId={(thread.environment as EnvironmentId | undefined) ?? environmentId}
                threadId={thread.id as ThreadId}
                label={thread.title ?? thread.id}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {idea.files.length ? (
        <ul className="space-y-1" aria-label="Linked files">
          {idea.files.map((file) => (
            <IdeaFileRow key={file.path} environmentId={environmentId} path={file.path} />
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1">
        {project ? (
          <Button size="sm" variant="ghost" onClick={() => onSelectProject(project.id)}>
            Open project
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={!canWrite} onClick={onEdit}>
          Edit
        </Button>
        <Menu>
          <MenuTrigger
            render={<Button size="sm" variant="outline" disabled={!canWrite || busy} />}
            aria-label={`Change status of ${idea.title}`}
          >
            Status <ChevronDownIcon className="size-3 opacity-50" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>Status</MenuGroupLabel>
              <MenuRadioGroup
                value={idea.status}
                onValueChange={(value) => {
                  if (value !== "promoted") void changeStatus(value as AiPmIdeaStatus);
                }}
              >
                {(["parked", "exploring", "dropped"] as const).map((status) => (
                  <MenuRadioItem key={status} value={status} closeOnClick>
                    {STATUS_LABEL[status]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>Promote to project</MenuSubTrigger>
              <MenuSubPopup>
                <MenuItem onClick={() => void changeStatus("promoted", null)}>
                  No project yet
                </MenuItem>
                {projects.map((entry) => (
                  <MenuItem key={entry.id} onClick={() => void changeStatus("promoted", entry.id)}>
                    {entry.name}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          </MenuPopup>
        </Menu>
      </div>
    </article>
  );
}

// Files open on the environment's own machine, so opening them only makes sense when that machine is this one.
function IdeaFileRow({
  environmentId,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly path: string;
}) {
  const remote = useRemoteOpenResolution(environmentId);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canOperate = useAtomValue(shellEnvironment.openInEditor.permissionAtom(environmentId));
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const canOpen =
    canOperate &&
    remote.isResolved &&
    remote.state.mode === "local-exec" &&
    (config?.availableEditors ?? []).includes("file-manager");
  const name = path.replace(/\/+$/, "").split("/").at(-1) || path;
  const launch = async (reveal: boolean) => {
    const result = await openInEditor({
      environmentId,
      input: { cwd: path, editor: "file-manager", ...(reveal ? { reveal: true } : {}) },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      reportFailure(`Could not open ${name}`, squashAtomCommandFailure(result));
  };
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <MiddleTruncate
        className="min-w-0 flex-1"
        value={path}
        tail={Math.min(name.length + 1, 48)}
      />
      {canOpen ? (
        <>
          <Button size="xs" variant="ghost" onClick={() => void launch(false)}>
            Open
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void launch(true)}>
            Reveal
          </Button>
        </>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => copyToClipboard(path, undefined)}>
          {isCopied ? "Copied" : "Copy path"}
        </Button>
      )}
    </li>
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function IdeaDialog({
  environmentId,
  idea,
  onClose,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly idea: AiPmIdea | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const save = useAtomCommand(serverEnvironment.saveAiPmIdea, { label: "AI PM idea save" });
  const [title, setTitle] = useState(idea?.title ?? "");
  const [summary, setSummary] = useState(idea?.summary ?? "");
  const [next, setNext] = useState(idea?.next ?? "");
  const [threadText, setThreadText] = useState(
    (idea?.threads ?? []).map((thread) => thread.id).join("\n"),
  );
  const [fileText, setFileText] = useState((idea?.files ?? []).map((file) => file.path).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    // Accept pasted thread links as well as bare ids.
    const threadIds = [
      ...new Set(lines(threadText).map((line) => parseThreadLinkHref(line) ?? line)),
    ];
    const threads = threadIds.map(
      (id): AiPmIdeaThread =>
        idea?.threads.find((thread) => thread.id === id) ?? { id, environment: environmentId },
    );
    const files = [...new Set(lines(fileText))];
    if (!title.trim()) return setError("Give the idea a title.");
    const relative = files.find((path) => !/^(\/|[A-Za-z]:[\\/])/.test(path));
    if (relative) return setError(`Use an absolute path: ${relative}`);
    setError(null);
    setSaving(true);
    const result = await save({
      environmentId,
      input: {
        ...(idea ? { id: idea.id } : {}),
        title: title.trim(),
        summary,
        next,
        threads,
        files: files.map((path) => ({ path })),
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      return;
    }
    onSaved();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{idea ? "Edit idea" : "New idea"}</DialogTitle>
          <DialogDescription>
            Park a concept with where you left off, so you can pick it up later.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Where you left off</span>
            <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Next step</span>
            <Textarea value={next} onChange={(event) => setNext(event.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Threads (one id or thread link per line)</span>
            <Textarea value={threadText} onChange={(event) => setThreadText(event.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">
              Files and folders (one absolute path per line)
            </span>
            <Textarea value={fileText} onChange={(event) => setFileText(event.target.value)} />
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save idea"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
