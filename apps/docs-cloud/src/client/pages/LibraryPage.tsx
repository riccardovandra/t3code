import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  DOC_STATUS_LABEL,
  DOC_STATUSES,
  type DocStatus,
  type LibraryProject,
} from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { docPath, navigate } from "../router.ts";

export function LibraryPage() {
  const [projects, setProjects] = useState<ReadonlyArray<LibraryProject> | null>(null);
  const [projectName, setProjectName] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocStatus | null>(null);

  const reload = useCallback(async () => {
    setProjects((await api.library()).projects);
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

  if (!projects) return null;

  return (
    <main className="page">
      <h1>Library</h1>
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
      {projects.length === 0 ? <p className="muted">No projects yet.</p> : null}
      {projects.length > 0 ? (
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
      ) : null}
      {projects.map((project) => (
        <ProjectSection key={project.id} project={project} statusFilter={statusFilter} />
      ))}
    </main>
  );
}

function ProjectSection(props: {
  readonly project: LibraryProject;
  readonly statusFilter: DocStatus | null;
}) {
  const [title, setTitle] = useState("");
  const { statusFilter } = props;
  const docs =
    statusFilter === null
      ? props.project.docs
      : props.project.docs.filter((doc) => doc.status === statusFilter);

  const createDoc = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const created = await api.createDoc(props.project.id, title.trim());
    navigate(docPath(created.doc.id));
  };

  return (
    <section className="project">
      <h2>{props.project.name}</h2>
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
