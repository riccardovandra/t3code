import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { LibraryProject } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { docPath, navigate } from "../router.ts";

const STATUS_LABEL = {
  thinking: "Thinking",
  plan: "Plan",
  in_progress: "In progress",
  done: "Done",
};

export function LibraryPage() {
  const [projects, setProjects] = useState<ReadonlyArray<LibraryProject> | null>(null);
  const [projectName, setProjectName] = useState("");

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
      {projects.map((project) => (
        <ProjectSection key={project.id} project={project} />
      ))}
    </main>
  );
}

function ProjectSection(props: { readonly project: LibraryProject }) {
  const [title, setTitle] = useState("");

  const createDoc = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const created = await api.createDoc(props.project.id, title.trim());
    navigate(docPath(created.doc.id));
  };

  return (
    <section className="project">
      <h2>{props.project.name}</h2>
      <ul className="doc-list">
        {props.project.docs.map((doc) => (
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
                {STATUS_LABEL[doc.status]} · {new Date(doc.updatedAt).toLocaleDateString()}
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
