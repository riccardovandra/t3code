import type { AiPmProjectSummary } from "@t3tools/contracts";

export type AiPmScope = "all" | "client" | "business";

export interface AiPmProjectGroup {
  readonly name: string;
  readonly waitingOnYou: number;
  readonly projects: ReadonlyArray<AiPmProjectSummary>;
}

const BUSINESS_GROUP = "Your business";

const byUrgency = (a: AiPmProjectSummary, b: AiPmProjectSummary) =>
  b.waitingOnYou - a.waitingOnYou || a.name.localeCompare(b.name);

/** Client projects group by client; everything else is the user's own business. */
export function groupAiPmProjects(
  projects: ReadonlyArray<AiPmProjectSummary>,
  scope: AiPmScope,
): ReadonlyArray<AiPmProjectGroup> {
  const groups = new Map<string, AiPmProjectSummary[]>();
  for (const project of projects) {
    const isClient = project.area === "client";
    if (scope !== "all" && isClient !== (scope === "client")) continue;
    const name = isClient ? project.owner : BUSINESS_GROUP;
    groups.set(name, [...(groups.get(name) ?? []), project]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({
      name,
      waitingOnYou: items.reduce((sum, project) => sum + project.waitingOnYou, 0),
      projects: items.toSorted(byUrgency),
    }))
    .toSorted(
      (a, b) =>
        Number(a.name === BUSINESS_GROUP) - Number(b.name === BUSINESS_GROUP) ||
        b.waitingOnYou - a.waitingOnYou ||
        a.name.localeCompare(b.name),
    );
}

export interface AiPmThreadTask {
  readonly title: string;
  readonly owner: string;
  readonly step: string | null;
  readonly why: string | null;
}

export function aiPmThreadPrompt(
  project: { readonly id: string; readonly name: string },
  task: AiPmThreadTask,
): string {
  return [
    `Work on this AI PM action and nothing else.`,
    ``,
    `Project: ${project.name} (${project.id})`,
    `Action: ${task.title}`,
    ...(task.step ? [`Step: ${task.step}`] : []),
    `Owner: ${task.owner}`,
    ...(task.why ? [`Why: ${task.why}`] : []),
    ``,
    `Run \`aipm brief ${project.id}\` first for context. When you finish, record progress on the step in AI PM.`,
  ].join("\n");
}
