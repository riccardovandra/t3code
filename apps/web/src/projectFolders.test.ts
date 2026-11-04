import { EnvironmentId, ProjectId, type ServerSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  groupProjectScopeItems,
  listProjectFolders,
  nextProjectScopeKeysForFolder,
  projectFolderPatches,
  renameProjectFolderPatches,
  resolveProjectFolder,
  type ProjectFolderSettingsLookup,
} from "./projectFolders";

const mac = EnvironmentId.make("mac");
const vps = EnvironmentId.make("vps");
const member = (environmentId: EnvironmentId, id: string) => ({
  environmentId,
  id: ProjectId.make(id),
});

function lookupFrom(folders: Record<string, Record<string, string>>): ProjectFolderSettingsLookup {
  return (environmentId) =>
    folders[environmentId]
      ? { projectFolders: folders[environmentId] as ServerSettings["projectFolders"] }
      : undefined;
}

const lookup = lookupFrom({
  mac: { tracker: "Internal Tooling", content: "Operations" },
  vps: { brand: "Clients", herbox: "Clients", shared: "Clients" },
});
const groups = [
  { projectKey: "tracker", memberProjects: [member(mac, "tracker")] },
  { projectKey: "content", memberProjects: [member(mac, "content")] },
  { projectKey: "brand", memberProjects: [member(vps, "brand")] },
  { projectKey: "herbox", memberProjects: [member(vps, "herbox")] },
  // The same repository on both machines; only the VPS checkout has a folder.
  { projectKey: "shared", memberProjects: [member(mac, "shared"), member(vps, "shared")] },
  { projectKey: "scratch", memberProjects: [member(mac, "scratch")] },
];

describe("resolveProjectFolder", () => {
  it("uses the first checkout that has a folder", () => {
    expect(resolveProjectFolder(groups[4]!.memberProjects, lookup)).toBe("Clients");
    expect(resolveProjectFolder(groups[5]!.memberProjects, lookup)).toBeNull();
  });
});

describe("listProjectFolders", () => {
  it("merges same-named folders across environments and sorts them", () => {
    expect(listProjectFolders(groups, lookup)).toEqual([
      "Clients",
      "Internal Tooling",
      "Operations",
    ]);
  });
});

describe("projectFolderPatches", () => {
  it("writes the folder to every checkout, one patch per environment", () => {
    const patches = projectFolderPatches(groups[4]!.memberProjects, "Clients");
    expect(patches.get(mac)).toEqual({ projectFolders: { shared: "Clients" } });
    expect(patches.get(vps)).toEqual({ projectFolders: { shared: "Clients" } });
  });
});

describe("renameProjectFolderPatches", () => {
  it("renames only projects in that folder", () => {
    const patches = renameProjectFolderPatches(groups, lookup, "Clients", "Customers");
    expect([...patches.keys()]).toEqual([vps]);
    expect(patches.get(vps)).toEqual({
      projectFolders: { brand: "Customers", herbox: "Customers", shared: "Customers" },
    });
  });

  it("deleting a folder clears it so its projects become unfiled", () => {
    const patches = renameProjectFolderPatches(groups, lookup, "Operations", null);
    expect(patches.get(mac)).toEqual({ projectFolders: { content: null } });
  });
});

describe("groupProjectScopeItems", () => {
  const items = ["tracker", "brand", "scratch", "content"].map((value) => ({ value }));
  const folderByProjectKey = new Map([
    ["tracker", "Internal Tooling"],
    ["brand", "Clients"],
    ["content", "Operations"],
  ]);

  it("leaves the list alone when no project has a folder", () => {
    expect(
      groupProjectScopeItems({ items, folderByProjectKey: new Map(), collapsedFolders: new Set() }),
    ).toEqual(items.map((item) => ({ kind: "project", item })));
  });

  it("puts folders in name order with unfiled projects last, and hides collapsed folders", () => {
    const entries = groupProjectScopeItems({
      items,
      folderByProjectKey,
      collapsedFolders: new Set(["Internal Tooling"]),
    });
    expect(
      entries.map((entry) =>
        entry.kind === "folder"
          ? `[${entry.label}${entry.collapsed ? " collapsed" : ""}]`
          : entry.item.value,
      ),
    ).toEqual([
      "[Clients]",
      "brand",
      "[Internal Tooling collapsed]",
      "[Operations]",
      "content",
      "[Unfiled]",
      "scratch",
    ]);
  });
});

describe("nextProjectScopeKeysForFolder", () => {
  it("clicking a folder scopes to exactly its projects", () => {
    expect(
      nextProjectScopeKeysForFolder({
        current: ["x"],
        folderProjectKeys: ["a", "b"],
        toggle: false,
      }),
    ).toEqual(["a", "b"]);
  });

  it("toggling adds a partly selected folder and removes a fully selected one", () => {
    expect(
      nextProjectScopeKeysForFolder({
        current: ["x", "a"],
        folderProjectKeys: ["a", "b"],
        toggle: true,
      }),
    ).toEqual(["x", "a", "b"]);
    expect(
      nextProjectScopeKeysForFolder({
        current: ["x", "a", "b"],
        folderProjectKeys: ["a", "b"],
        toggle: true,
      }),
    ).toEqual(["x"]);
  });
});
