import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { aiPmThreadPrompt, type AiPmThreadTask } from "./aiPmBoard";

// AI PM's board is read-only, so manual links live with this client.
const LINKS_KEY = "t3code:ai-pm-project-links";
const Links = Schema.Record(Schema.String, Schema.String);

/**
 * The T3 project an AI PM project's threads start in. An explicit link wins; otherwise a
 * project in the same environment with the same name. Same environment only, because the
 * drafted prompt runs that environment's `aipm`.
 */
export function useAiPmUpProject(
  environmentId: EnvironmentId,
  aiPmProject: { readonly id: string; readonly name: string },
) {
  const [links, setLinks] = useLocalStorage(LINKS_KEY, {}, Links);
  const candidates = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const linkKey = `${environmentId}:${aiPmProject.id}`;
  const linkedId = links[linkKey];
  const name = aiPmProject.name.toLowerCase();
  const project =
    (linkedId ? candidates.find((p) => p.id === linkedId) : undefined) ??
    candidates.find((p) => p.title.toLowerCase() === name);
  const setLinkedProjectId = (projectId: string | null) =>
    setLinks((current) => {
      const { [linkKey]: _previous, ...rest } = current;
      return projectId ? { ...rest, [linkKey]: projectId } : rest;
    });
  return { project, candidates, setLinkedProjectId };
}

export function useStartAiPmThread(
  aiPmProject: { readonly id: string; readonly name: string },
  upProject: { readonly environmentId: EnvironmentId; readonly id: ProjectId } | undefined,
) {
  const handleNewThread = useNewThreadHandler();
  if (!upProject) return null;
  return async (task: AiPmThreadTask) => {
    const opened = await handleNewThread(scopeProjectRef(upProject.environmentId, upProject.id));
    // Drafted, not sent: the user reviews the focus before an agent spends a turn on it.
    if (opened) {
      useComposerDraftStore
        .getState()
        .setPrompt(opened.draftId, aiPmThreadPrompt(aiPmProject, task));
    }
  };
}
