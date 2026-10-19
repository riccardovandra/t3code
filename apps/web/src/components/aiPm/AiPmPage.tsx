import type { AiPmBriefResult, AiPmProjectSummary, EnvironmentId } from "@t3tools/contracts";
import { ArrowLeftIcon, ListChecksIcon } from "lucide-react";
import { useId, useState } from "react";

import { isElectron } from "../../env";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { AiPmIdeas } from "./AiPmIdeas";

export function AiPmPage({
  projectId,
  environmentId: requestedEnvironmentId,
  onSelectProject,
  onSelectEnvironment,
}: {
  readonly projectId: string | undefined;
  readonly environmentId: string | undefined;
  readonly onSelectProject: (id: string | undefined) => void;
  readonly onSelectEnvironment: (id: string) => void;
}) {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environment = environments.find(
    (entry) => entry.environmentId === (requestedEnvironmentId ?? primaryEnvironmentId),
  );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron} className="border-b border-border">
        <ListChecksIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">AI PM</span>
        <span className="ml-auto text-xs text-muted-foreground">Projects and ideas</span>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide">
          <div className="flex flex-wrap gap-2" aria-label="Environment">
            {environments.map((entry) => (
              <Button
                key={entry.environmentId}
                size="sm"
                variant={entry.environmentId === environment?.environmentId ? "secondary" : "ghost"}
                aria-pressed={entry.environmentId === environment?.environmentId}
                onClick={() => onSelectEnvironment(entry.environmentId)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
          {environment ? (
            <AiPmEnvironment
              key={environment.environmentId}
              environmentId={environment.environmentId}
              projectId={projectId}
              onSelectProject={onSelectProject}
            />
          ) : (
            <Notice
              title="Connect to a project environment"
              description={
                requestedEnvironmentId
                  ? "The selected environment is unavailable. Choose another environment above."
                  : "Connect a computer running UP Orchestrator to read its AI PM board."
              }
            />
          )}
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}

export function AiPmEnvironment({
  environmentId,
  projectId,
  onSelectProject,
  embedded = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string | undefined;
  readonly onSelectProject: (id: string | undefined) => void;
  readonly embedded?: boolean;
}) {
  const list = useEnvironmentQuery(serverEnvironment.aiPmList({ environmentId, input: {} }));
  const [filter, setFilter] = useState("");
  const projects = (list.data?.projects ?? []).filter((project) => !project.closed);
  const visible = projects
    .filter((project) =>
      `${project.name} ${project.owner} ${project.now}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
    )
    .toSorted((a, b) => b.waitingOnYou - a.waitingOnYou || a.name.localeCompare(b.name));
  const waiting = projects.reduce((sum, project) => sum + project.waitingOnYou, 0);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {embedded ? (
            <h2 className="text-lg font-semibold tracking-tight">Your projects</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">Where your projects stand</h1>
          )}
          <p className="text-sm text-muted-foreground">
            {list.data
              ? `${projects.length} open projects · ${waiting} items need you`
              : "Project status hasn’t loaded yet"}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={list.isPending} onClick={list.refresh}>
          <RefreshIcon size="sm" refreshing={list.isPending} />{" "}
          {embedded ? "Refresh" : "Refresh projects"}
        </Button>
      </div>
      {list.error ? (
        <Notice title="Couldn’t read the AI PM board" description={list.error} />
      ) : null}
      {list.data ? (
        <p className="text-xs text-muted-foreground">
          Board read {new Date(list.data.fetchedAt).toLocaleString()}. Status comes from AI PM;
          reading does not reconcile or verify the work.
        </p>
      ) : null}
      {list.isPending && !list.data ? <p role="status">Reading the project board…</p> : null}
      {projectId ? (
        <>
          <div>
            <Button variant="ghost" size="sm" onClick={() => onSelectProject(undefined)}>
              <ArrowLeftIcon className="size-4" /> All projects
            </Button>
          </div>
          <AiPmProject key={projectId} environmentId={environmentId} projectId={projectId} />
        </>
      ) : list.data ? (
        <>
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects, ideas, clients or current focus…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className={embedded ? "grid min-w-0 gap-3" : "grid gap-3 md:grid-cols-2"}>
            {visible.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => onSelectProject(project.id)}
              />
            ))}
          </div>
          {visible.length === 0 ? (
            <Notice
              title={projects.length === 0 ? "No open projects" : "No matching projects"}
              description={
                projects.length === 0
                  ? "Projects from this environment’s AI PM board will appear here."
                  : "Try a different project name or client."
              }
            />
          ) : null}
        </>
      ) : null}
      {projectId ? null : (
        <AiPmIdeas
          environmentId={environmentId}
          filter={filter}
          projects={projects}
          embedded={embedded}
          onSelectProject={onSelectProject}
        />
      )}
    </>
  );
}

function ProjectCard({
  project,
  onOpen,
}: {
  readonly project: AiPmProjectSummary;
  readonly onOpen: () => void;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card/30 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{project.owner}</span>
        {project.waitingOnYou > 0 ? (
          <Badge variant="warning">{project.waitingOnYou} need you</Badge>
        ) : (
          <Badge variant="secondary">No asks flagged</Badge>
        )}
      </div>
      <h2 className="text-lg font-medium">{project.name}</h2>
      <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Now: </span>
        {project.now || "Current focus hasn’t been recorded."}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {project.version ? `${project.version} · ` : ""}
          {project.done}/{project.total} total steps recorded complete
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Open ${project.name} brief`}
          onClick={onOpen}
        >
          Open brief
        </Button>
      </div>
    </article>
  );
}

function AiPmProject({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
}) {
  const brief = useEnvironmentQuery(
    serverEnvironment.aiPmBrief({ environmentId, input: { projectId } }),
  );
  return (
    <>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={brief.isPending} onClick={brief.refresh}>
          <RefreshIcon size="sm" refreshing={brief.isPending} /> Refresh brief
        </Button>
      </div>
      {brief.error ? <Notice title="Couldn’t read this project" description={brief.error} /> : null}
      {brief.isPending && !brief.data ? <p role="status">Reading the project brief…</p> : null}
      {brief.data ? <ProjectBrief brief={brief.data} /> : null}
    </>
  );
}

function ProjectBrief({ brief }: { readonly brief: AiPmBriefResult }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const stepIdPrefix = useId();
  const activePhases = brief.phases.filter((phase) => showCompleted || !phase.shipped);
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {brief.owner}
          {brief.updated ? ` · Board updated ${brief.updated}` : ""} · Read{" "}
          {new Date(brief.fetchedAt).toLocaleString()}
        </p>
        <h2 className="text-2xl font-semibold">{brief.name}</h2>
        <BriefSection title="Objective" text={brief.objective || "No objective recorded."} />
        <BriefSection title="Now" text={brief.now || "No current focus recorded."} />
      </div>
      {brief.version ? (
        <section className="space-y-2 rounded-xl border border-border bg-card/30 p-5">
          <h3 className="font-medium">{brief.version} · Current outcome</h3>
          <p className="text-sm leading-relaxed">{brief.outcome}</p>
          {brief.shipWhen ? <BriefSection title="Complete when" text={brief.shipWhen} /> : null}
        </section>
      ) : null}
      <section className="space-y-3">
        <h3 className="font-medium">Next actions</h3>
        {brief.next.length ? (
          <ul className="space-y-3">
            {brief.next.map((action) => (
              <li
                key={`${action.step}-${action.title}`}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  {action.step ? (
                    <a
                      className="text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
                      href={`#${stepIdPrefix}-ai-pm-step-${action.step}`}
                      onClick={() => {
                        const target = document.getElementById(
                          `${stepIdPrefix}-ai-pm-step-${action.step}`,
                        );
                        if (target instanceof HTMLDetailsElement) {
                          target.open = true;
                          const phase = target.parentElement?.closest("details");
                          if (phase instanceof HTMLDetailsElement) phase.open = true;
                        }
                      }}
                    >
                      {action.title}
                    </a>
                  ) : (
                    <span className="text-sm font-medium">{action.title}</span>
                  )}
                  <Badge variant={action.owner === "you" ? "warning" : "secondary"}>
                    {action.owner}
                  </Badge>
                </div>
                {action.why ? (
                  <p className="mt-2 text-sm text-muted-foreground">{action.why}</p>
                ) : null}
                {action.step ? (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    {action.step.includes("/") ? action.step : `${brief.id}/${action.step}`}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No next action recorded. This does not mean the project is complete.
          </p>
        )}
      </section>
      {brief.risks.length ? (
        <section className="space-y-3">
          <h3 className="font-medium">Risks to keep in view</h3>
          {brief.risks.map((risk) => (
            <div key={risk.code} className="rounded-lg border border-warning/30 p-4">
              <p className="text-sm font-medium">
                {risk.code} · {risk.title}
              </p>
              {risk.context ? (
                <p className="mt-2 text-sm text-muted-foreground">{risk.context}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Project plan</h3>
          <Button size="sm" variant="ghost" onClick={() => setShowCompleted(!showCompleted)}>
            {showCompleted ? "Hide completed steps" : "Show completed steps"}
          </Button>
        </div>
        {activePhases.map((phase) => {
          const steps = phase.steps.filter((step) => showCompleted || step.state !== "done");
          return steps.length ? (
            <details
              key={`${phase.version}-${phase.kind}-${phase.name}`}
              open={phase.kind !== "inbox" && phase.kind !== "later"}
              className="rounded-xl border border-border p-5"
            >
              <summary className="cursor-pointer text-sm font-medium">
                {phase.name} · {steps.length} steps
              </summary>
              <div className="mt-4 divide-y divide-border">
                {steps.map((step) => (
                  <details
                    key={step.ref}
                    id={`${stepIdPrefix}-ai-pm-step-${step.ref}`}
                    className="scroll-mt-4 py-3"
                  >
                    <summary className="cursor-pointer text-sm">
                      <span className="mr-2">
                        <Badge
                          variant={
                            step.state === "blocked" || step.state === "check"
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {step.state}
                        </Badge>
                      </span>
                      {step.title} <span className="text-muted-foreground">· {step.owner}</span>
                    </summary>
                    <div className="mt-3 space-y-2 pl-2 text-sm leading-relaxed text-muted-foreground">
                      <p className="break-all font-mono text-xs">{step.ref}</p>
                      {step.what ? <p>{step.what}</p> : null}
                      {step.waitingTitles.length ? (
                        <p>Depends on: {step.waitingTitles.join(", ")}</p>
                      ) : null}
                      {step.warnings.map((warning) => (
                        <p key={warning} className="text-warning-foreground">
                          {warning}
                        </p>
                      ))}
                      {step.lastProgress ? (
                        <div>
                          <p className="font-medium">Latest recorded update</p>
                          <p className="whitespace-pre-wrap">{step.lastProgress}</p>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ) : null;
        })}
        {activePhases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open plan recorded.</p>
        ) : null}
      </section>
    </div>
  );
}

function BriefSection({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
    </div>
  );
}

function Notice({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <div role="status" className="space-y-2 rounded-xl border border-border p-6">
      <h2 className="font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
