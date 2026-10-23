/**
 * Docs Cloud's projects are T3 Code projects, identified by a key: the git
 * remote's canonical key such as `github.com/owner/repo`, so every checkout of
 * a repository on every machine shares one project, else `title:` and the
 * normalised title. The T3 server, its clients and Docs Cloud all derive keys
 * here so they agree.
 */

/** Titles compare ignoring case and spacing. */
export const projectNameKey = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

const TITLE_KEY_PREFIX = "title:";
export const MAX_PROJECT_KEY_LENGTH = 300;

export const titleProjectKey = (name: string): string => TITLE_KEY_PREFIX + projectNameKey(name);

/**
 * A T3 project's key. It uses the project's own remote, not the fork parent
 * in `repositoryIdentity.origin`, so forks stay separate projects.
 */
export const docsCloudProjectKey = (project: {
  readonly title: string;
  readonly repositoryIdentity?: { readonly canonicalKey: string } | null | undefined;
}): string => project.repositoryIdentity?.canonicalKey ?? titleProjectKey(project.title);

/** A key in its stored form (title keys normalised), or null when it is not a usable key. */
export function normalizeProjectKey(key: string): string | null {
  const trimmed = key.trim();
  const normalized = trimmed.toLowerCase().startsWith(TITLE_KEY_PREFIX)
    ? titleProjectKey(trimmed.slice(TITLE_KEY_PREFIX.length))
    : trimmed;
  return normalized.length > 0 &&
    normalized !== TITLE_KEY_PREFIX &&
    normalized.length <= MAX_PROJECT_KEY_LENGTH
    ? normalized
    : null;
}

/** A display name for a key nobody named: the repository or the title. */
export const projectNameFromKey = (key: string): string =>
  key.startsWith(TITLE_KEY_PREFIX)
    ? key.slice(TITLE_KEY_PREFIX.length)
    : (key.split("/").findLast((part) => part.length > 0) ?? key);
