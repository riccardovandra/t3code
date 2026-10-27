import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type SkillTrashEntry,
} from "@t3tools/contracts";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext, useState } from "react";

import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import type { SkillEnvironment } from "./SkillEnvironments";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/*
 * Fork: Remove moves a skill into its environment's trash. The Tools page
 * lists each environment's trash here, with Restore and Delete permanently.
 */

export interface TrashedSkill {
  readonly environmentId: EnvironmentId;
  readonly entry: SkillTrashEntry;
}

const trashAtom = (environmentId: EnvironmentId) =>
  serverEnvironment.listSkillTrash({ environmentId, input: {} });

const trashByEnvironment = Atom.family((key: string) =>
  Atom.make((get) =>
    (key === "" ? [] : (key.split(",") as EnvironmentId[])).map((environmentId) => ({
      environmentId,
      entries: Option.getOrNull(AsyncResult.value(get(trashAtom(environmentId))))?.entries ?? [],
    })),
  ).pipe(Atom.withLabel(`web:skill-trash:${key}`)),
);

/**
 * The trash entries the scope shows, newest first: everything on each
 * environment, or at project scope only what was removed from that checkout.
 */
function trashedInScope(
  lists: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly entries: ReadonlyArray<SkillTrashEntry>;
  }>,
  environments: ReadonlyArray<SkillEnvironment>,
): ReadonlyArray<TrashedSkill> {
  return lists
    .flatMap(({ environmentId, entries }) => {
      const cwd = environments.find((candidate) => candidate.environmentId === environmentId)?.cwd;
      return entries
        .filter(
          (entry) => cwd === null || (entry.target.kind === "project" && entry.target.cwd === cwd),
        )
        .map((entry) => ({ environmentId, entry }));
    })
    .toSorted((left, right) => right.entry.removedAt.localeCompare(left.entry.removedAt));
}

/** Each environment's skill trash, and the last removal this page made, for its Restore. */
export function useSkillTrash(environments: ReadonlyArray<SkillEnvironment>) {
  const key = environments.map((environment) => environment.environmentId).join(",");
  const lists = useAtomValue(trashByEnvironment(key));
  const registry = useContext(RegistryContext);
  const [removed, setRemoved] = useState<{
    readonly name: string;
    readonly environmentIds: ReadonlyArray<EnvironmentId>;
  } | null>(null);
  return {
    entries: trashedInScope(lists, environments),
    refresh: () => {
      for (const environment of environments)
        registry.refresh(trashAtom(environment.environmentId));
    },
    removed,
    setRemoved,
  };
}

export type SkillTrashState = ReturnType<typeof useSkillTrash>;

function locationLabel(entry: SkillTrashEntry): string {
  return entry.target.kind === "project" ? entry.target.cwd : "Home folders";
}

function useTrashActions(
  environments: ReadonlyArray<SkillEnvironment>,
  trash: SkillTrashState,
  onChanged: () => void,
) {
  const restoreSkill = useAtomCommand(serverEnvironment.restoreSkill, { reportFailure: false });
  const deleteSkill = useAtomCommand(serverEnvironment.deleteSkillFromTrash, {
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (id: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === id)?.label ?? "Environment";
  const run = async (
    action: "restore" | "delete",
    items: ReadonlyArray<TrashedSkill>,
  ): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      const failures = await Promise.all(
        items.map(async ({ environmentId, entry }) => {
          const command = action === "restore" ? restoreSkill : deleteSkill;
          const result = await command({ environmentId, input: { id: entry.id } });
          return result._tag === "Failure"
            ? `${label(environmentId)}: ${formatEnvironmentQueryError(result.cause)}`
            : null;
        }),
      );
      const messages = failures.filter((message) => message !== null);
      if (messages.length > 0) {
        setError(
          `Couldn't ${action === "restore" ? "restore" : "delete"} ${items[0]?.entry.name ?? "the skill"}. ${messages.join(" ")}`,
        );
      }
      return messages.length === 0;
    } finally {
      setBusy(false);
      trash.refresh();
      onChanged();
    }
  };
  return { run, error, busy };
}

/** Shown after a removal: where the skill went, and a way straight back. */
export function SkillTrashNotice({
  environments,
  trash,
  onChanged,
}: {
  readonly environments: ReadonlyArray<SkillEnvironment>;
  readonly trash: SkillTrashState;
  readonly onChanged: () => void;
}) {
  const { run, error, busy } = useTrashActions(environments, trash, onChanged);
  const { removed } = trash;
  if (removed === null) return null;
  // The newest entry of that name on each environment the removal reached.
  const latest = removed.environmentIds.flatMap((environmentId) => {
    const found = trash.entries.find(
      (item) =>
        item.environmentId === environmentId &&
        item.entry.name.toLowerCase() === removed.name.toLowerCase(),
    );
    return found === undefined ? [] : [found];
  });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{error ?? `Moved ${removed.name} to the trash. It's listed under Trash below.`}</span>
      {latest.length > 0 ? (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run("restore", latest).then((restored) => {
              if (restored) trash.setRemoved(null);
            })
          }
        >
          Restore
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" onClick={() => trash.setRemoved(null)}>
        Dismiss
      </Button>
    </div>
  );
}

/** Settings → Tools → Trash: skills Remove moved aside, to restore or delete for good. */
export function SkillTrashSection({
  environments,
  trash,
  onChanged,
}: {
  readonly environments: ReadonlyArray<SkillEnvironment>;
  readonly trash: SkillTrashState;
  readonly onChanged: () => void;
}) {
  const managers = useEnvironmentsWithScope(environments, AuthProvidersManageScope);
  const { run, error, busy } = useTrashActions(environments, trash, onChanged);
  const [deleting, setDeleting] = useState<TrashedSkill | null>(null);
  const fleet = environments.length > 1;
  const label = (id: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === id)?.label ?? "Environment";
  if (trash.entries.length === 0) return null;
  return (
    <SettingsSection title={`Trash (${trash.entries.length})`}>
      {error !== null ? (
        <p className="px-3 py-2 text-xs text-destructive-foreground sm:px-4">{error}</p>
      ) : null}
      {trash.entries.map((item) => {
        const { entry, environmentId } = item;
        const canManage = managers.has(environmentId);
        return (
          <SettingsRow
            key={`${environmentId}:${entry.id}`}
            title={entry.name}
            description={[
              fleet ? label(environmentId) : null,
              locationLabel(entry),
              `removed ${formatRelativeTimeLabel(entry.removedAt)}`,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
            control={
              canManage ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run("restore", [item])}
                  >
                    Restore
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={busy}
                    onClick={() => setDeleting(item)}
                  >
                    Delete permanently
                  </Button>
                </div>
              ) : null
            }
          />
        );
      })}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.entry.name} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes its files from the trash. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting !== null) void run("delete", [deleting]);
                setDeleting(null);
              }}
            >
              Delete permanently
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}
