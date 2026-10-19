import type { EnvironmentId } from "@t3tools/contracts";
import { AiPmEnvironment } from "./AiPmPage";

export function AiPmPanel({
  environmentId,
  projectId,
  onSelectProject,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string | undefined;
  readonly onSelectProject: (projectId: string | undefined) => void;
}) {
  return (
    <section aria-label="AI PM project board" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-3 p-3">
        <AiPmEnvironment
          environmentId={environmentId}
          projectId={projectId}
          onSelectProject={onSelectProject}
          embedded
        />
      </div>
    </section>
  );
}
