import { useCallback, useEffect, useState, type FormEvent } from "react";

import { titleProjectKey } from "../../shared/embed.ts";
import {
  DOC_STATUS_LABEL,
  DOC_STATUSES,
  type DocStatus,
  type DocSummary,
  type Library,
} from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { useEmbedProject } from "../embedContext.ts";
import { docPath, navigate } from "../router.ts";

export function LibraryPage() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [projectName, setProjectName] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocStatus | null>(null);
  const embedProject = useEmbedProject();
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(async () => {
    setLibrary(await api.library());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectName.trim()) return;
    await api.createProject(projectName.trim());
    setProjectName("");
    await reload();
  };

  if (!library) return null;
  const { projects, noProjectDocs } = library;

  const statusButtons = (
    <div className="status-filter" role="group" aria-label="Filter by status">
      {[null, ...DOC_STATUSES].map((status) => (
        <button
          key={status ?? "all"}
          type="button"
          aria-pressed={statusFilter === status}
          onClick={() => setStatusFilter(status)}
        >
          {status === null ? "All" : DOC_STATUS_LABEL[status]}
        </button>
      ))}
    </div>
  );

  // Inside a T3 Code project the library opens on that project's docs. The T3
  // server syncs its projects, so a miss is a project it has not synced yet:
  // that one is created with the first doc, not on every visit.
  if (embedProject !== null && !showAll) {
    const key = embedProject.key ?? titleProjectKey(embedProject.name);
    const match = projects.find((project) => project.key === key);
    return (
      <main className="page">
        <div className="page-heading">
          <h1>{match?.name ?? embedProject.name}</h1>
          <button type="button" className="link-button" onClick={() => setShowAll(true)}>
            All projects
          </button>
        </div>
        {match ? statusButtons : null}
        <ProjectSection
          key={match?.id ?? "new"}
          name={null}
          docs={match?.docs ?? []}
          statusFilter={statusFilter}
          projectId={async () =>
            match?.id ?? (await api.createProject(embedProject.name, key)).project.id
          }
        />
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-heading">
        <h1>Library</h1>
        {embedProject !== null ? (
          <button type="button" className="link-button" onClick={() => setShowAll(false)}>
            Only {embedProject.name}
          </button>
        ) : null}
      </div>
      <form onSubmit={createProject} className="inline-form">
        <input
          placeholder="New project name"
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
        />
        <button type="submit" className="button">
          Create project
        </button>
      </form>
      {projects.length === 0 && noProjectDocs.length === 0 ? (
        <p className="muted">No projects yet.</p>
      ) : (
        statusButtons
      )}
      {projects.map((project) => (
        <ProjectSection
          key={project.id}
          name={project.name}
          docs={project.docs}
          statusFilter={statusFilter}
          projectId={async () => project.id}
        />
      ))}
      <ProjectSection
        name="No project"
        docs={noProjectDocs}
        statusFilter={statusFilter}
        projectId={async () => null}
      />
    </main>
  );
}

function ProjectSection(props: {
  /** Null when the page heading already names the project. */
  readonly name: string | null;
  readonly docs: ReadonlyArray<DocSummary>;
  readonly statusFilter: DocStatus | null;
  /** Null files the doc in no project. */
  readonly projectId: () => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const { statusFilter } = props;
  const docs =
    statusFilter === null ? props.docs : props.docs.filter((doc) => doc.status === statusFilter);

  const createDoc = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const created = await api.createDoc(await props.projectId(), title.trim());
    navigate(docPath(created.doc.id));
  };

  return (
    <section className="project">
      {props.name !== null ? <h2>{props.name}</h2> : null}
      {props.name === null && props.docs.length === 0 ? (
        <p className="muted">No docs in this project yet.</p>
      ) : null}
      {statusFilter !== null && docs.length === 0 ? (
        <p className="muted">No {DOC_STATUS_LABEL[statusFilter]} docs.</p>
      ) : null}
      <ul className="doc-list">
        {docs.map((doc) => (
          <li key={doc.id}>
            <a
              href={docPath(doc.id)}
              onClick={(event) => {
                event.preventDefault();
                navigate(docPath(doc.id));
              }}
            >
              <span className="doc-list-title">{doc.title}</span>
              <span className="doc-list-meta">
                {DOC_STATUS_LABEL[doc.status]} · {new Date(doc.updatedAt).toLocaleDateString()}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <form onSubmit={createDoc} className="inline-form">
        <input
          placeholder="New doc title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button type="submit" className="button secondary">
          New doc
        </button>
      </form>
    </section>
  );
}
