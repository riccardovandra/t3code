/**
 * Fork: Settings → Tools → Library. The skills in each saved source, where
 * they are installed on the environment, and Install for the environment or
 * one of its projects. Sources are saved on the environment; installs go
 * through `skills.install` like Add skills.
 */
import {
  type EnvironmentId,
  type SavedSkillSource,
  type SkillInstallTarget,
  type SkillLibrarySkill,
  type SkillSourceId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type * as Cause from "effect/Cause";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useState } from "react";

import { useProjects } from "../../state/entities";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { Label } from "../ui/label";
import { Menu, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { TruncatedText } from "./TruncatedText";

interface InstallOption {
  readonly key: string;
  readonly label: string;
  readonly target: SkillInstallTarget;
}

/** The environment, then its projects by name. */
function useInstallOptions(environmentId: EnvironmentId): ReadonlyArray<InstallOption> {
  const projects = useProjects();
  return [
    { key: "", label: "This environment", target: { kind: "environment" } },
    ...projects
      .filter((project) => project.environmentId === environmentId && !project.isScratch)
      .toSorted((left, right) => left.title.localeCompare(right.title))
      .map((project) => ({
        key: project.workspaceRoot,
        label: project.title,
        target: { kind: "project", cwd: project.workspaceRoot } as const,
      })),
  ];
}

const installedLabel = (target: SkillInstallTarget, options: ReadonlyArray<InstallOption>) =>
  target.kind === "environment"
    ? "This environment"
    : (options.find((option) => option.key === target.cwd)?.label ??
      target.cwd.split(/[\\/]/).findLast((part) => part.length > 0) ??
      target.cwd);

export function SkillLibrarySection({
  environmentId,
  onInstalled,
}: {
  readonly environmentId: EnvironmentId;
  /** Rescan the Skills list after an install. */
  readonly onInstalled: () => void;
}) {
  const sources = useEnvironmentQuery(
    serverEnvironment.listSkillSources({ environmentId, input: {} }),
  );
  const canManage = useAtomValue(serverEnvironment.upsertSkillSource.permissionAtom(environmentId));
  const canInstall = useAtomValue(serverEnvironment.installSkills.permissionAtom(environmentId));
  const options = useInstallOptions(environmentId);
  const [managing, setManaging] = useState(false);
  const saved = sources.data?.sources ?? [];

  return (
    <>
      <SettingsSection
        title="Library"
        headerAction={
          canManage ? (
            <Button size="xs" variant="outline" onClick={() => setManaging(true)}>
              Sources
            </Button>
          ) : null
        }
      >
        {sources.error !== null ? (
          <SettingsRow title="Couldn't read the saved sources" description={sources.error} />
        ) : saved.length === 0 && sources.isSuccess ? (
          <SettingsRow
            title="No saved sources"
            description="Save a skill source to browse and install its skills here."
          />
        ) : null}
        {saved.map((source) => (
          <LibrarySource
            key={source.id}
            environmentId={environmentId}
            source={source}
            defaultOpen={saved.length === 1}
            options={options}
            canInstall={canInstall}
            onInstalled={onInstalled}
          />
        ))}
      </SettingsSection>
      {managing ? (
        <SkillSourcesDialog
          environmentId={environmentId}
          sources={saved}
          onOpenChange={setManaging}
          onChanged={sources.refresh}
        />
      ) : null}
    </>
  );
}

function LibrarySource({
  environmentId,
  source,
  defaultOpen,
  options,
  canInstall,
  onInstalled,
}: {
  readonly environmentId: EnvironmentId;
  readonly source: SavedSkillSource;
  readonly defaultOpen: boolean;
  readonly options: ReadonlyArray<InstallOption>;
  readonly canInstall: boolean;
  readonly onInstalled: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Read only once opened: a preview fetches the whole source.
  const library = useEnvironmentQuery(
    open
      ? serverEnvironment.listSkillLibrary({ environmentId, input: { sourceId: source.id } })
      : null,
  );
  const refetch = useAtomCommand(serverEnvironment.refreshSkillLibrary, { reportFailure: false });
  const install = useAtomCommand(serverEnvironment.installSkills, { reportFailure: false });
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listing = library.data?.sources[0];
  const skills = listing?.skills ?? [];

  const refresh = async () => {
    setRefreshing(true);
    await refetch({ environmentId, input: { sourceId: source.id, refresh: true } });
    library.refresh();
    setRefreshing(false);
  };

  const installSkill = async (skill: SkillLibrarySkill, option: InstallOption) => {
    setInstalling(skill.name);
    setError(null);
    const result = await install({
      environmentId,
      input: { source: source.source, skills: [skill.name], target: option.target },
    });
    setInstalling(null);
    if (result._tag === "Failure") {
      setError(formatEnvironmentQueryError(result.cause));
      return;
    }
    const failed = result.value.outcomes.find((outcome) => outcome.status !== "installed");
    if (failed !== undefined) setError(`${skill.folder}: ${failed.error ?? failed.status}`);
    library.refresh();
    onInstalled();
  };

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <div className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="shrink-0 text-sm font-medium">{source.label}</span>
          <TruncatedText className="font-mono text-xs text-muted-foreground" text={source.source} />
        </button>
        {open && listing !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {skills.length === 1 ? "1 skill" : `${skills.length} skills`}
          </span>
        ) : null}
        {open ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={`Fetch ${source.label} again`}
                  disabled={refreshing || library.isPending}
                  onClick={() => void refresh()}
                />
              }
            >
              <RefreshIcon refreshing={refreshing || library.isPending} />
            </TooltipTrigger>
            <TooltipPopup side="top">Fetch the source again</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {!open ? null : library.error !== null || listing?.error !== undefined ? (
        <p className="px-4 pb-3 text-xs text-destructive-foreground sm:px-5">
          {library.error ?? listing?.error}
        </p>
      ) : listing === undefined ? (
        <p className="flex items-center gap-2 px-4 pb-3 text-xs text-muted-foreground sm:px-5">
          <Spinner /> Reading {source.label}…
        </p>
      ) : (
        <ul className="divide-y divide-border/50 border-t border-border/40">
          {skills.map((skill) => (
            <li key={skill.name} className="flex items-center gap-3 px-4 py-2 sm:px-5">
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{skill.folder}</span>
                  {skill.scripts ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className="inline-flex shrink-0 text-warning-foreground" />}
                      >
                        <AlertTriangleIcon aria-label="Includes scripts" className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">Includes scripts</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  {skill.installedAt.map((target) => (
                    <Badge
                      key={target.kind === "environment" ? "" : target.cwd}
                      variant="success"
                      size="sm"
                    >
                      {installedLabel(target, options)}
                    </Badge>
                  ))}
                </span>
                <TruncatedText
                  className="text-xs text-muted-foreground"
                  text={skill.description || "No description."}
                />
              </span>
              {canInstall ? (
                <Menu>
                  <MenuTrigger
                    render={<Button size="xs" variant="outline" disabled={installing !== null} />}
                  >
                    {installing === skill.name ? <Spinner /> : null}
                    {skill.installedAt.length > 0 ? "Reinstall" : "Install"}
                    <ChevronDownIcon aria-hidden className="size-3" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuGroupLabel>Install {skill.folder} for</MenuGroupLabel>
                    {options.map((option, index) => (
                      <div key={option.key}>
                        {index === 1 ? <MenuSeparator /> : null}
                        <MenuItem onClick={() => void installSkill(skill, option)}>
                          {option.label}
                        </MenuItem>
                      </div>
                    ))}
                  </MenuPopup>
                </Menu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error !== null ? (
        <p className="px-4 pb-3 text-xs whitespace-pre-line text-destructive-foreground sm:px-5">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Add, edit and remove the environment's saved sources. */
function SkillSourcesDialog({
  environmentId,
  sources,
  onOpenChange,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly sources: ReadonlyArray<SavedSkillSource>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChanged: () => void;
}) {
  const id = useId();
  const upsert = useAtomCommand(serverEnvironment.upsertSkillSource, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.removeSkillSource, { reportFailure: false });
  const [editing, setEditing] = useState<SkillSourceId | null>(null);
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (saved: SavedSkillSource | null) => {
    setEditing(saved?.id ?? null);
    setLabel(saved?.label ?? "");
    setSource(saved?.source ?? "");
    setError(null);
  };

  const run = async (
    change: () => Promise<
      | { readonly _tag: "Success" }
      | { readonly _tag: "Failure"; readonly cause: Cause.Cause<unknown> }
    >,
  ) => {
    setBusy(true);
    setError(null);
    const result = await change();
    setBusy(false);
    if (result._tag === "Failure") {
      setError(formatEnvironmentQueryError(result.cause));
      return false;
    }
    onChanged();
    return true;
  };

  const save = async () => {
    if (label.trim() === "" || source.trim() === "" || busy) return;
    const saved = await run(() =>
      upsert({
        environmentId,
        input: {
          ...(editing === null ? {} : { id: editing }),
          label: label.trim(),
          source: source.trim(),
        },
      }),
    );
    if (saved) startEdit(null);
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Skill sources</DialogTitle>
          <DialogDescription>
            The Library lists the skills in each source saved on this environment.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-4">
            {sources.length > 0 ? (
              <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border">
                {sources.map((saved) => (
                  <li key={saved.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{saved.label}</span>
                      <TruncatedText
                        className="font-mono text-xs text-muted-foreground"
                        text={saved.source}
                      />
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label={`Edit ${saved.label}`}
                      disabled={busy}
                      onClick={() => startEdit(saved)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost-destructive"
                      aria-label={`Remove ${saved.label}`}
                      disabled={busy}
                      onClick={() =>
                        void run(() => remove({ environmentId, input: { id: saved.id } })).then(
                          (removed) => removed && editing === saved.id && startEdit(null),
                        )
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-label`}>Name</Label>
                <Input
                  id={`${id}-label`}
                  placeholder="Team skills"
                  value={label}
                  disabled={busy}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-source`}>Source</Label>
                <Input
                  id={`${id}-source`}
                  font="mono"
                  placeholder="owner/repo"
                  value={source}
                  disabled={busy}
                  spellCheck={false}
                  onChange={(event) => setSource(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  A GitHub <code>owner/repo</code>, a GitHub tree URL for a folder in a repository,
                  a git URL, or a folder on the environment.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                {editing !== null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => startEdit(null)}
                  >
                    Cancel edit
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy || label.trim() === "" || source.trim() === ""}
                >
                  {busy ? <Spinner /> : editing === null ? <PlusIcon aria-hidden /> : null}
                  {editing === null ? "Add source" : "Save source"}
                </Button>
              </div>
            </form>
            {error !== null ? (
              <p className="text-xs whitespace-pre-line text-destructive-foreground">{error}</p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
