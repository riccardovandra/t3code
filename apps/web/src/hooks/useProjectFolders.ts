import type { EnvironmentId, ProjectId, ServerSettingsPatch } from "@t3tools/contracts";
import {
  listProjectFolders,
  projectFolderPatches,
  renameProjectFolderPatches,
  resolveProjectFolder,
  type ProjectFolderSettingsLookup,
} from "../projectFolders";
import { useServerConfigs } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useSidebarProjectGroups } from "./useSidebarProjectGroups";

interface FolderMember {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
}

export function useProjectFolders() {
  const serverConfigs = useServerConfigs();
  const groups = useSidebarProjectGroups();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "project folder update");
  const lookup: ProjectFolderSettingsLookup = (environmentId) =>
    serverConfigs.get(environmentId)?.settings;
  // Environments without a loaded config cannot take the write; they keep their stored folder.
  const write = (patches: ReadonlyMap<EnvironmentId, ServerSettingsPatch>) =>
    Promise.all(
      [...patches]
        .filter(([environmentId]) => serverConfigs.has(environmentId))
        .map(([environmentId, patch]) => updateSettings({ environmentId, input: { patch } })),
    );
  return {
    folders: listProjectFolders(groups, lookup),
    projectCountByFolder: (folder: string) =>
      groups.filter((group) => resolveProjectFolder(group.memberProjects, lookup) === folder)
        .length,
    folderOf: (members: readonly FolderMember[]) => resolveProjectFolder(members, lookup),
    setFolder: (members: readonly FolderMember[], folder: string | null) =>
      write(projectFolderPatches(members, folder)),
    renameFolder: (from: string, to: string | null) =>
      write(renameProjectFolderPatches(groups, lookup, from, to)),
  };
}
