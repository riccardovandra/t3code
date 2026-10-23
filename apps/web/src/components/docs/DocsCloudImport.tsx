import { useAtomValue } from "@effect/atom-react";
import type {
  DocsCloudImportFileResult,
  DocsCloudImportRecord,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { CloudIcon, CloudUploadIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";

/** Present when Docs Cloud is set up; opens an app path such as `/d/:docId` in the panel. */
export interface DocsCloudTarget {
  readonly open: (path: string) => void;
}

interface ImportScope {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
}

export function useDocsCloudImports(scope: ImportScope, enabled: boolean) {
  const query = useEnvironmentQuery(
    enabled
      ? serverEnvironment.docsCloudImports({
          environmentId: scope.environmentId,
          input: { projectId: scope.projectId, cwd: scope.cwd },
        })
      : null,
  );
  const imports = new Map<string, DocsCloudImportRecord>(
    (query.data?.imports ?? []).map((record) => [record.docPath, record]),
  );
  return { query, imports, docs: query.data?.docs ?? [] };
}

function useImportCommand(scope: ImportScope) {
  const canImport = useAtomValue(
    serverEnvironment.importDocsToCloud.permissionAtom(scope.environmentId),
  );
  const run = useAtomCommand(serverEnvironment.importDocsToCloud, "import into Docs Cloud");
  const importOne = async (docPath: string, update: boolean) => {
    const result = await run({
      environmentId: scope.environmentId,
      input: { projectId: scope.projectId, cwd: scope.cwd, docPaths: [docPath], update },
    });
    if (result._tag === "Success") return result.value.results[0] ?? null;
    return null;
  };
  return { canImport, importOne };
}

function commentNote(result: DocsCloudImportFileResult): string | null {
  const missing = result.commentsSkipped.filter((c) => c.reason === "text_not_found").length;
  const failed = result.commentsSkipped.length - missing;
  const parts = [
    result.commentsImported > 0 ? `${result.commentsImported} comments moved` : null,
    missing > 0 ? `${missing} skipped because their text is no longer in the doc` : null,
    failed > 0 ? `${failed} could not be added` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** "Move to Docs Cloud", or "Imported to Docs Cloud" with Open and Update, for one doc. */
export function DocsCloudDocActions(props: {
  readonly scope: ImportScope;
  readonly docPath: string;
  readonly target: DocsCloudTarget;
}) {
  const { query, imports } = useDocsCloudImports(props.scope, true);
  const { canImport, importOne } = useImportCommand(props.scope);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const record = imports.get(props.docPath);

  const run = async (update: boolean) => {
    setBusy(true);
    setNotice(null);
    const result = await importOne(props.docPath, update);
    setBusy(false);
    query.refresh();
    if (result === null) return;
    setNotice(
      result.status === "failed"
        ? `Could not move this doc: ${result.error ?? "unknown error"}`
        : result.status === "updated"
          ? "Docs Cloud now has this file's current text."
          : (commentNote(result) ?? "Moved to Docs Cloud. This file stays in the project."),
    );
  };

  return (
    <>
      {record ? (
        <>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => props.target.open(`/d/${record.docId}`)}
          >
            <CloudIcon />
            Imported to Docs Cloud
          </Button>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!canImport || busy}
            onClick={() => void run(true)}
          >
            {busy ? "Updating…" : "Update"}
          </Button>
        </>
      ) : (
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={!canImport || busy || query.data === undefined}
          onClick={() => void run(false)}
        >
          <CloudUploadIcon />
          {busy ? "Moving…" : "Move to Docs Cloud"}
        </Button>
      )}
      {notice ? (
        <span role="status" className="max-w-64 truncate text-xs text-muted-foreground">
          {notice}
        </span>
      ) : null}
    </>
  );
}

/** Imports every doc in the checkout one at a time, so progress and failures show per file. */
export function DocsCloudImportAll(props: { readonly scope: ImportScope }) {
  const { query, imports, docs } = useDocsCloudImports(props.scope, true);
  const { canImport, importOne } = useImportCommand(props.scope);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ReadonlyArray<DocsCloudImportFileResult> | null>(null);
  const pending = docs.filter((doc) => !imports.has(doc.docPath));

  const run = async () => {
    const queue = pending.map((doc) => doc.docPath);
    const finished: Array<DocsCloudImportFileResult> = [];
    setResults(null);
    for (const [index, docPath] of queue.entries()) {
      setProgress({ done: index, total: queue.length });
      finished.push(
        (await importOne(docPath, false)) ?? {
          docPath,
          status: "failed",
          doc: null,
          error: "The import request failed.",
          commentsImported: 0,
          commentsSkipped: [],
        },
      );
    }
    setProgress(null);
    setResults(finished);
    query.refresh();
  };

  const failed = results?.filter((result) => result.status === "failed") ?? [];
  const skippedComments =
    results?.reduce((count, result) => count + result.commentsSkipped.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-1 border-b border-border px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" aria-live="polite">
          {progress
            ? `Moving ${progress.done + 1} of ${progress.total} to Docs Cloud…`
            : results
              ? `Moved ${results.length - failed.length} of ${results.length} docs to Docs Cloud.${
                  skippedComments > 0 ? ` ${skippedComments} comments could not be placed.` : ""
                }`
              : docs.length === 0
                ? "No docs to move to Docs Cloud."
                : `${imports.size} of ${docs.length} docs are in Docs Cloud.`}
        </span>
        <Button
          size="xs"
          variant="outline"
          disabled={!canImport || progress !== null || pending.length === 0}
          onClick={() => void run()}
        >
          <CloudUploadIcon />
          Import all
        </Button>
      </div>
      {failed.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-destructive">
          {failed.map((result) => (
            <li key={result.docPath} className="truncate">
              <span className="font-mono">{result.docPath}</span>: {result.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
