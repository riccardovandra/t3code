import type {
  EnvironmentId,
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";

/** Each environment stores folders for its own projects; a group's folder comes from its checkouts. */
export type ProjectFolderSettingsLookup = (
  environmentId: EnvironmentId,
) => Pick<ServerSettings, "projectFolders"> | undefined;

interface FolderMember {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
}

interface FolderGroup {
  readonly projectKey: string;
  readonly memberProjects: readonly FolderMember[];
}

const PROJECT_FOLDER_SCOPE_PREFIX = "project-folder:";
/** Collapse key for projects without a folder; real folder names are never empty. */
const UNFILED_PROJECT_FOLDER_KEY = "";

export function resolveProjectFolder(
  members: readonly FolderMember[],
  lookup: ProjectFolderSettingsLookup,
): string | null {
  for (const member of members) {
    const folder = lookup(member.environmentId)?.projectFolders[member.id];
    if (folder) return folder;
  }
  return null;
}

export function listProjectFolders(
  groups: readonly FolderGroup[],
  lookup: ProjectFolderSettingsLookup,
): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    const folder = resolveProjectFolder(group.memberProjects, lookup);
    if (folder) names.add(folder);
  }
  return [...names].toSorted((a, b) => a.localeCompare(b));
}

/** Writes one folder to every checkout, so each environment agrees on the group's folder. */
export function projectFolderPatches(
  members: readonly FolderMember[],
  folder: string | null,
): Map<EnvironmentId, ServerSettingsPatch> {
  const patches = new Map<EnvironmentId, Record<ProjectId, string | null>>();
  for (const member of members) {
    const entries = patches.get(member.environmentId) ?? {};
    entries[member.id] = folder;
    patches.set(member.environmentId, entries);
  }
  return new Map(
    [...patches].map(([environmentId, projectFolders]) => [environmentId, { projectFolders }]),
  );
}

/** Rename or delete (`to: null`) a folder everywhere it is used. */
export function renameProjectFolderPatches(
  groups: readonly FolderGroup[],
  lookup: ProjectFolderSettingsLookup,
  from: string,
  to: string | null,
): Map<EnvironmentId, ServerSettingsPatch> {
  const members = groups
    .flatMap((group) => group.memberProjects)
    .filter((member) => lookup(member.environmentId)?.projectFolders[member.id] === from);
  return projectFolderPatches(members, to);
}

export type ProjectScopeEntry<TItem> =
  | { readonly kind: "project"; readonly item: TItem }
  | {
      readonly kind: "folder";
      readonly value: string;
      readonly label: string;
      readonly folderKey: string;
      readonly projectKeys: readonly string[];
      readonly collapsed: boolean;
    };

function projectFolderScopeValue(folderKey: string): string {
  return `${PROJECT_FOLDER_SCOPE_PREFIX}${folderKey}`;
}

/**
 * Orders picker projects by folder, with a header per folder and unfiled projects last. Without
 * folders the list is unchanged. Collapsed folders keep their header and hide their projects.
 */
export function groupProjectScopeItems<TItem extends { readonly value: string }>(input: {
  readonly items: readonly TItem[];
  readonly folderByProjectKey: ReadonlyMap<string, string>;
  readonly collapsedFolders: ReadonlySet<string>;
}): ProjectScopeEntry<TItem>[] {
  const projectEntries = input.items.map((item) => ({ kind: "project" as const, item }));
  if (input.folderByProjectKey.size === 0) return projectEntries;
  const byFolder = new Map<string, TItem[]>();
  for (const item of input.items) {
    const folderKey = input.folderByProjectKey.get(item.value) ?? UNFILED_PROJECT_FOLDER_KEY;
    byFolder.set(folderKey, [...(byFolder.get(folderKey) ?? []), item]);
  }
  const folderKeys = [...byFolder.keys()]
    .filter((key) => key !== UNFILED_PROJECT_FOLDER_KEY)
    .toSorted((a, b) => a.localeCompare(b));
  if (byFolder.has(UNFILED_PROJECT_FOLDER_KEY)) folderKeys.push(UNFILED_PROJECT_FOLDER_KEY);
  return folderKeys.flatMap((folderKey) => {
    const items = byFolder.get(folderKey) ?? [];
    const collapsed = input.collapsedFolders.has(folderKey);
    return [
      {
        kind: "folder" as const,
        value: projectFolderScopeValue(folderKey),
        label: folderKey === UNFILED_PROJECT_FOLDER_KEY ? "Unfiled" : folderKey,
        folderKey,
        projectKeys: items.map((item) => item.value),
        collapsed,
      },
      ...(collapsed ? [] : items.map((item) => ({ kind: "project" as const, item }))),
    ];
  });
}

/** Clicking a folder scopes to it; toggling adds its projects, or removes them when all are in. */
export function nextProjectScopeKeysForFolder(input: {
  readonly current: readonly string[];
  readonly folderProjectKeys: readonly string[];
  readonly toggle: boolean;
}): string[] {
  if (!input.toggle) return [...input.folderProjectKeys];
  const current = new Set(input.current);
  const allIn = input.folderProjectKeys.every((key) => current.has(key));
  for (const key of input.folderProjectKeys) {
    if (allIn) current.delete(key);
    else current.add(key);
  }
  return [...current];
}
