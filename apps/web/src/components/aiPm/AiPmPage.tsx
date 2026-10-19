import type { AiPmBriefResult, AiPmProjectSummary, EnvironmentId } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ListChecksIcon,
  MessageSquarePlusIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useNewProject } from "../../hooks/useNewProject";
import { groupAiPmProjects, type AiPmScope, type AiPmThreadTask } from "./aiPmBoard";
import { useAiPmUpProject, useStartAiPmThread } from "./useAiPmUpProject";

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
        <span className="ml-auto text-xs text-muted-foreground">Project overview</span>
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
                  : "Connect a computer running T3 Code to read its AI PM board."
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
  const [scope, setScope] = useState<AiPmScope>("all");
  const projects = (list.data?.projects ?? []).filter((project) => !project.closed);
  const query = filter.toLowerCase();
  const groups = groupAiPmProjects(
    projects.filter((project) =>
      `${project.name} ${project.owner} ${project.now}`.toLowerCase().includes(query),
    ),
    scope,
  );
  const waiting = projects.reduce((sum, project) => sum + project.waitingOnYou, 0);
  const selected = projects.find((project) => project.id === projectId);
  return (
    <div className="@container/ai-pm flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        {embedded ? (
          <h2 className="text-sm font-semibold">Projects</h2>
        ) : (
          <h1 className="text-sm font-semibold">Projects</h1>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {list.data
            ? `${projects.length} open · ${waiting} need you · read ${new Date(list.data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Not loaded yet"}
        </span>
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh projects"
          disabled={list.isPending}
          onClick={list.refresh}
        >
          <RefreshIcon size="sm" refreshing={list.isPending} />
        </Button>
      </div>
      {list.error ? (
        <Notice title="Couldn’t read the AI PM board" description={list.error} />
      ) : null}
      {list.isPending && !list.data ? (
        <p role="status" className="text-xs text-muted-foreground">
          Reading the project board…
        </p>
      ) : null}
      {list.data ? (
        <div className="flex min-w-0 flex-col gap-3 @2xl/ai-pm:flex-row">
          <nav
            aria-label="AI PM projects"
            className={`flex min-w-0 shrink-0 flex-col gap-2 @2xl/ai-pm:w-60 ${selected ? "hidden @2xl/ai-pm:flex" : ""}`}
          >
            <Input
              type="search"
              size="compact"
              aria-label="Search projects"
              placeholder="Filter projects or clients"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="flex gap-1" role="group" aria-label="Project type">
              {(
                [
                  ["all", "All"],
                  ["client", "Clients"],
                  ["business", "Business"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="compact"
                  variant={scope === key ? "secondary" : "ghost"}
                  aria-pressed={scope === key}
                  onClick={() => setScope(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {groups.map((group) => (
              <div key={group.name} className="flex flex-col">
                <h3 className="px-1.5 pt-1 pb-0.5 text-xs text-muted-foreground">{group.name}</h3>
                {group.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    aria-current={project.id === projectId ? "true" : undefined}
                    onClick={() => onSelectProject(project.id)}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent/50 aria-[current=true]:bg-accent aria-[current=true]:font-medium"
                  >
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {project.waitingOnYou > 0 ? (
                      <span className="text-xs text-warning-foreground">
                        {project.waitingOnYou}
                        <span className="sr-only"> need you</span>
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 ? (
              <p className="px-1.5 text-xs text-muted-foreground">
                {projects.length === 0 ? "No open projects." : "No matching projects."}
              </p>
            ) : null}
          </nav>
          <div className="min-w-0 flex-1 @2xl/ai-pm:border-l @2xl/ai-pm:border-border @2xl/ai-pm:pl-4">
            {selected ? (
              <>
                <Button
                  size="compact"
                  variant="ghost"
                  className="mb-1 @2xl/ai-pm:hidden"
                  onClick={() => onSelectProject(undefined)}
                >
                  <ArrowLeftIcon /> Projects
                </Button>
                <AiPmProject key={selected.id} environmentId={environmentId} project={selected} />
              </>
            ) : projectId ? (
              <Notice
                title="Project not on the board"
                description="It may have closed. Choose another project."
              />
            ) : (
              <p className="hidden py-8 text-center text-sm text-muted-foreground @2xl/ai-pm:block">
                Choose a project to see its next actions and plan.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AiPmProject({
  environmentId,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: AiPmProjectSummary;
}) {
  const brief = useEnvironmentQuery(
    serverEnvironment.aiPmBrief({ environmentId, input: { projectId: project.id } }),
  );
  const upProject = useAiPmUpProject(environmentId, project);
  const startThread = useStartAiPmThread(project, upProject.project);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold">{project.name}</h2>
          <span className="shrink-0 text-xs text-muted-foreground">{project.owner}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {project.version ? `${project.version} · ` : ""}
            {project.done}/{project.total} done
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh brief"
            disabled={brief.isPending}
            onClick={brief.refresh}
          >
            <RefreshIcon size="sm" refreshing={brief.isPending} />
          </Button>
        </div>
        <UpProjectMenu environmentId={environmentId} project={project} upProject={upProject} />
        {brief.data?.objective ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{brief.data.objective}</p>
        ) : null}
      </header>
      {brief.error ? <Notice title="Couldn’t read this project" description={brief.error} /> : null}
      {brief.isPending && !brief.data ? (
        <p role="status" className="text-xs text-muted-foreground">
          Reading the project brief…
        </p>
      ) : null}
      {brief.data ? <ProjectBrief brief={brief.data} startThread={startThread} /> : null}
    </div>
  );
}

function UpProjectMenu({
  environmentId,
  project,
  upProject: { project: linked, candidates, setLinkedProjectId },
}: {
  readonly environmentId: EnvironmentId;
  readonly project: AiPmProjectSummary;
  readonly upProject: ReturnType<typeof useAiPmUpProject>;
}) {
  const createNewProject = useNewProject();
  const [creating, setCreating] = useState(false);
  return (
    <Menu>
      <MenuTrigger render={<Button size="compact" variant="ghost-muted" className="self-start" />}>
        {linked ? `Threads start in ${linked.title}` : "Not linked to a project"}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={linked?.id ?? ""}
          onValueChange={(value) => setLinkedProjectId(value || null)}
        >
          <MenuGroupLabel>Start this project’s threads in</MenuGroupLabel>
          {candidates.map((candidate) => (
            <MenuRadioItem key={candidate.id} value={candidate.id}>
              {candidate.title}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            // Created with the AI PM name, so the name match links it without storing anything.
            await createNewProject({ environmentId, name: project.name, publishTo: null });
            setLinkedProjectId(null);
            setCreating(false);
          }}
        >
          Create “{project.name}” as a new project
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function ProjectBrief({
  brief,
  startThread,
}: {
  readonly brief: AiPmBriefResult;
  readonly startThread: ((task: AiPmThreadTask) => Promise<void>) | null;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const phases = brief.phases.filter((phase) => showCompleted || !phase.shipped);
  return (
    <>
      {brief.now ? (
        <p className="text-xs">
          <span className="font-medium">Now: </span>
          {brief.now}
        </p>
      ) : null}
      <section className="flex flex-col">
        <SectionTitle>Next actions</SectionTitle>
        {brief.next.map((action) => (
          <TaskRow
            key={`${action.step}-${action.title}`}
            task={action}
            detail={action.why}
            startThread={startThread}
          />
        ))}
        {brief.next.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No next action recorded. This does not mean the project is complete.
          </p>
        ) : null}
      </section>
      {brief.risks.length ? (
        <section className="flex flex-col gap-1">
          <SectionTitle>Risks</SectionTitle>
          {brief.risks.map((risk) => (
            <div key={risk.code} className="text-xs">
              <p>
                <span className="text-warning-foreground">{risk.code}</span> {risk.title}
              </p>
              {risk.context ? (
                <p className="line-clamp-2 text-muted-foreground">{risk.context}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      <section className="flex flex-col">
        <div className="flex items-center">
          <SectionTitle>Plan</SectionTitle>
          <Button
            className="ml-auto"
            size="compact"
            variant="ghost"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted ? "Hide completed" : "Show completed"}
          </Button>
        </div>
        {phases.map((phase) => {
          const steps = phase.steps.filter((step) => showCompleted || step.state !== "done");
          return steps.length ? (
            <div key={`${phase.version}-${phase.kind}-${phase.name}`} className="mb-2">
              <h4 className="py-0.5 text-xs font-medium">{phase.name}</h4>
              {steps.map((step) => (
                <TaskRow
                  key={step.ref}
                  task={{ title: step.title, owner: step.owner, step: step.ref, why: step.what }}
                  state={step.state}
                  detail={[
                    step.what,
                    step.waitingTitles.length
                      ? `Depends on: ${step.waitingTitles.join(", ")}`
                      : null,
                    ...step.warnings,
                    step.lastProgress ? `Latest update: ${step.lastProgress}` : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                  startThread={startThread}
                />
              ))}
            </div>
          ) : null;
        })}
        {phases.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open plan recorded.</p>
        ) : null}
      </section>
      <p className="text-xs text-muted-foreground">
        Status comes from AI PM. Reading it does not reconcile or verify the work.
      </p>
    </>
  );
}

const STATE_DOT: Record<AiPmBriefResult["phases"][number]["steps"][number]["state"], string> = {
  done: "bg-success",
  active: "bg-info",
  blocked: "bg-destructive",
  check: "bg-warning",
  todo: "bg-muted-foreground/40",
  parked: "bg-muted-foreground/20",
};

function TaskRow({
  task,
  state,
  detail,
  startThread,
}: {
  readonly task: AiPmThreadTask;
  readonly state?: keyof typeof STATE_DOT;
  readonly detail: string | null;
  readonly startThread: ((task: AiPmThreadTask) => Promise<void>) | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/60 last:border-0">
      <div className="flex min-w-0 items-center gap-2 py-0.5 text-xs">
        <span
          className={`size-1.5 shrink-0 rounded-full ${state ? STATE_DOT[state] : task.owner === "you" ? "bg-warning" : "bg-muted-foreground/40"}`}
        />
        {state ? <span className="sr-only">{state}</span> : null}
        <button
          type="button"
          aria-expanded={detail ? open : undefined}
          disabled={!detail}
          onClick={() => setOpen(!open)}
          className={`min-w-0 flex-1 truncate text-left ${state === "done" ? "text-muted-foreground line-through" : ""}`}
        >
          {task.title}
        </button>
        <Badge size="sm" variant={task.owner === "you" ? "warning" : "secondary"}>
          {task.owner}
        </Badge>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!startThread}
                aria-label={`Start a thread for ${task.title}`}
                onClick={() => void startThread?.(task)}
              />
            }
          >
            <MessageSquarePlusIcon />
          </TooltipTrigger>
          <TooltipPopup>
            {startThread
              ? "Start a thread focused on this. The prompt is drafted, not sent."
              : "Choose a project for this board’s threads first"}
          </TooltipPopup>
        </Tooltip>
      </div>
      {open && detail ? (
        <p className="pb-1.5 pl-3.5 text-xs whitespace-pre-wrap text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { readonly children: string }) {
  return (
    <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function Notice({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <div role="status" className="space-y-1 rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
