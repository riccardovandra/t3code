#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- A thin laptop release wrapper around git, gh, and the desktop build script.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { applyForkBranding } from "./fork-brand.ts";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const UPSTREAM_REPOSITORY = "pingdotgg/t3code";
const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Extracts `owner/repo` from an HTTPS or SSH GitHub remote URL. */
export function parseGitHubRepository(remoteUrl: string): string | undefined {
  const match = remoteUrl
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    );
  return match ? `${match[1]}/${match[2]}` : undefined;
}

export function assertForkRepository(repository: string): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error(`Invalid repository '${repository}'. Expected owner/repo.`);
  }
  if (repository.toLowerCase() === UPSTREAM_REPOSITORY) {
    throw new Error(`Refusing to publish to ${UPSTREAM_REPOSITORY}. Use your fork.`);
  }
}

function parseSemver(version: string): [number, number, number] | undefined {
  const match = version.match(SEMVER);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Plain `vX.Y.Z` tags only: preview and PR builds ship without an update feed
 * and nightly lives on its own channel, so neither can be the baseline.
 */
export function resolveNextVersion(tags: ReadonlyArray<string>, packageVersion: string): string {
  let highest = parseSemver(packageVersion);
  if (!highest) throw new Error(`Package version '${packageVersion}' is not plain semver.`);
  for (const tag of tags) {
    const match = tag.match(SEMVER_TAG);
    if (!match) continue;
    const version: [number, number, number] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    if (compareSemver(version, highest) > 0) highest = version;
  }
  return `${highest[0]}.${highest[1]}.${highest[2] + 1}`;
}

export function assertReleasableVersion(version: string, tags: ReadonlyArray<string>): void {
  if (!SEMVER.test(version)) {
    throw new Error(
      `Version '${version}' must be plain X.Y.Z. Prerelease suffixes build without the stable update feed.`,
    );
  }
  if (tags.includes(`v${version}`)) {
    throw new Error(`Tag v${version} already exists on the fork. Pick a higher --version.`);
  }
}

export function expectedMacArtifacts(version: string, arch: string): ReadonlyArray<string> {
  const base = `UP-Orchestrator-${version}-${arch}`;
  return [
    `${base}.dmg`,
    `${base}.dmg.blockmap`,
    `${base}.zip`,
    `${base}.zip.blockmap`,
    "latest-mac.yml",
  ];
}

/** Reads `git ls-remote --tags` output into bare tag names. */
export function parseRemoteTags(lsRemoteOutput: string): ReadonlyArray<string> {
  const tags = new Set<string>();
  for (const line of lsRemoteOutput.split("\n")) {
    const ref = line.split("\t")[1]?.trim();
    if (ref?.startsWith("refs/tags/"))
      tags.add(ref.slice("refs/tags/".length).replace(/\^\{\}$/, ""));
  }
  return [...tags];
}

export function appUpdateYmlNamesRepository(appUpdateYml: string, repository: string): boolean {
  const [owner, repo] = repository.split("/");
  return (
    /^provider:\s*github\s*$/m.test(appUpdateYml) &&
    new RegExp(`^owner:\\s*${owner}\\s*$`, "m").test(appUpdateYml) &&
    new RegExp(`^repo:\\s*${repo}\\s*$`, "m").test(appUpdateYml)
  );
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function run(command: string, args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryRun(command: string, args: ReadonlyArray<string>): string | undefined {
  try {
    return run(command, args);
  } catch {
    return undefined;
  }
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

function formatCommand(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function resolveReleaseNotes(previousTag: string | undefined): string {
  const log =
    previousTag && tryRun("git", ["rev-parse", "--verify", "--quiet", `${previousTag}^{commit}`])
      ? tryRun("git", [
          "log",
          "--no-merges",
          "--format=- %s",
          "--max-count=50",
          `${previousTag}..HEAD`,
        ])
      : undefined;
  return log ? `Changes since ${previousTag}:\n\n${log}` : "Desktop build of this fork.";
}

function main(): void {
  const { values } = NodeUtil.parseArgs({
    options: {
      repo: { type: "string" },
      version: { type: "string" },
      arch: { type: "string", default: "arm64" },
      "dry-run": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  const dryRun = values["dry-run"];
  const arch = values.arch;

  const repository =
    values.repo ?? parseGitHubRepository(run("git", ["remote", "get-url", "origin"]));
  if (!repository) throw new Error("Could not derive owner/repo from origin. Pass --repo.");
  assertForkRepository(repository);

  const tags = parseRemoteTags(
    run("git", ["ls-remote", "--tags", `https://github.com/${repository}.git`]),
  );
  const desktopPackage = JSON.parse(
    NodeFS.readFileSync(NodePath.join(repoRoot, "apps/desktop/package.json"), "utf8"),
  ) as { version: string };
  const version = values.version ?? resolveNextVersion(tags, desktopPackage.version);
  assertReleasableVersion(version, tags);
  const tag = `v${version}`;
  const previousTag = tags
    .filter((candidate) => SEMVER_TAG.test(candidate))
    .toSorted((a, b) =>
      compareSemver(parseSemver(a.slice(1)) ?? [0, 0, 0], parseSemver(b.slice(1)) ?? [0, 0, 0]),
    )
    .at(-1);

  const sha = run("git", ["rev-parse", "HEAD"]);
  const dirty = run("git", ["status", "--porcelain"]) !== "";
  const pushed = tryRun("git", ["branch", "-r", "--contains", sha])
    ?.split("\n")
    .some((branch) => branch.trim().startsWith("origin/"));

  const outputDir = NodePath.join("release", `fork-${tag}`);
  const buildArgs = [
    "scripts/build-desktop-artifact.ts",
    "--platform",
    "mac",
    "--target",
    "dmg",
    "--arch",
    arch,
    "--build-version",
    version,
    "--output-dir",
    outputDir,
  ];
  const buildEnv = {
    T3CODE_DESKTOP_UPDATE_REPOSITORY: repository,
    T3CODE_DESKTOP_VERSION: version,
  };
  const artifacts = expectedMacArtifacts(version, arch).map((file) =>
    NodePath.join(outputDir, file),
  );
  const notes = resolveReleaseNotes(previousTag);
  const ghArgs = [
    "release",
    "create",
    tag,
    ...artifacts,
    "--repo",
    repository,
    "--target",
    sha,
    "--title",
    `UP Orchestrator ${version}`,
    "--latest",
    "--notes",
    notes,
  ];

  print(`Repository:   ${repository}`);
  print(`Version:      ${version} (tag ${tag}, previous ${previousTag ?? "none"})`);
  print(`Commit:       ${sha}${dirty ? " (working tree has uncommitted changes)" : ""}`);
  print(
    `Build:        ${Object.entries(buildEnv)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ")} ${formatCommand("node", buildArgs)}`,
  );
  print(`Artifacts:\n${artifacts.map((file) => `  ${file}`).join("\n")}`);
  print(`Publish:      ${formatCommand("gh", ghArgs)}`);
  if (!pushed) print(`Warning: ${sha.slice(0, 12)} is not on any origin branch yet.`);

  if (dryRun) {
    print("\nDry run: nothing was built or published.");
    return;
  }
  if (dirty && !values["allow-dirty"]) {
    throw new Error("Working tree has uncommitted changes. Commit them or pass --allow-dirty.");
  }
  if (!pushed) {
    throw new Error(
      "Push the current commit to your fork first; the release tag is created on it.",
    );
  }

  // Ctrl-C reaches the build too; staying alive lets the finally block put the source back.
  const ignoreInterrupt = () => {};
  process.on("SIGINT", ignoreInterrupt);
  const restoreSource = applyForkBranding(repoRoot);
  try {
    NodeChildProcess.execFileSync("node", buildArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...buildEnv },
    });
  } finally {
    restoreSource();
    process.off("SIGINT", ignoreInterrupt);
  }

  const missing = artifacts.filter((file) => !NodeFS.existsSync(NodePath.join(repoRoot, file)));
  if (missing.length > 0) throw new Error(`Build did not produce: ${missing.join(", ")}`);
  const zip = artifacts.find((file) => file.endsWith(".zip"));
  const appUpdateYml = zip
    ? tryRun("unzip", ["-p", zip, "*.app/Contents/Resources/app-update.yml"])
    : undefined;
  if (!appUpdateYml || !appUpdateYmlNamesRepository(appUpdateYml, repository)) {
    throw new Error(`The built app's app-update.yml does not point at ${repository}.`);
  }

  NodeChildProcess.execFileSync("gh", ghArgs, { cwd: repoRoot, stdio: "inherit" });
  print(`\nPublished ${tag}. Installed builds will offer it on their next update check.`);
  print("The Release fork CLI workflow now attaches the Linux CLI archive to it.");
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
