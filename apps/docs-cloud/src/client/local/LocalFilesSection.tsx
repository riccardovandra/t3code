import { localDocAppPath, type LocalDocSummary } from "@t3tools/shared/docsCloudLocal";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DocIcon } from "../home/icons.tsx";
import { navigate } from "../router.ts";
import { hostClient } from "./hostClient.ts";

/**
 * The T3 Code project's markdown files under `docs/`, on the home page when
 * Docs Cloud runs inside T3 Code. They open on the local route and are never
 * sent to the Docs Cloud worker.
 */
export function LocalFilesSection(props: { readonly query: string }) {
  const [files, setFiles] = useState<ReadonlyArray<LocalDocSummary> | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      setFiles((await hostClient.request({ kind: "files.list" })).files);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return hostClient.onFilesChanged(() => void reload());
  }, [reload]);

  const query = props.query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      (files ?? []).filter(
        (file) =>
          !query ||
          file.title.toLowerCase().includes(query) ||
          file.path.toLowerCase().includes(query),
      ),
    [files, query],
  );

  if (files === null && !failed) return null;

  return (
    <section className="local-files" aria-label="Project files">
      <h2 className="home-section-label">Project files</h2>
      {failed && files === null ? (
        <p className="home-empty">
          Could not list this project's files.{" "}
          <button type="button" className="link-button" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : visible.length === 0 ? (
        <p className="home-empty">
          {query
            ? `No project files match "${props.query.trim()}".`
            : "No markdown files in this project's docs/ folder yet."}
        </p>
      ) : (
        <ul className="local-files-list">
          {visible.map((file) => (
            <li key={file.path}>
              <a
                href={localDocAppPath(file.path)}
                className="local-file"
                onClick={(event) => {
                  event.preventDefault();
                  navigate(localDocAppPath(file.path));
                }}
              >
                <DocIcon size={16} />
                <span className="local-file-title">{file.title}</span>
                <span className="local-file-path">{file.path}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
