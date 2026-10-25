import type { LocalDocImport } from "@t3tools/shared/docsCloudLocal";

/** What a finished Move to Docs Cloud or Update tells the user. */
export function importNotice(result: LocalDocImport): string {
  if (result.status === "updated") return "Docs Cloud now has this file's current text.";
  if (result.status === "skipped") return "This file is already in Docs Cloud.";
  const parts = [
    result.commentsImported > 0
      ? `${result.commentsImported} ${result.commentsImported === 1 ? "comment" : "comments"} moved`
      : null,
    result.commentsSkipped > 0
      ? `${result.commentsSkipped} could not be placed because their text changed`
      : null,
  ].filter((part) => part !== null);
  return parts.length > 0
    ? `Moved to Docs Cloud: ${parts.join(", ")}. This file stays in the project.`
    : "Moved to Docs Cloud. This file stays in the project.";
}
