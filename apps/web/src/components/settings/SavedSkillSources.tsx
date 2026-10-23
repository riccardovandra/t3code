/** Fork: the environment's saved skill sources, as a quick pick in Add skills. */
import type { EnvironmentId, SavedSkillSource } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";

const NONE: ReadonlyArray<SavedSkillSource> = [];

export function useSavedSkillSources(environmentId: EnvironmentId) {
  return (
    useEnvironmentQuery(serverEnvironment.listSkillSources({ environmentId, input: {} })).data
      ?.sources ?? NONE
  );
}

export function SavedSourcePicker({
  sources,
  disabled,
  onPick,
}: {
  readonly sources: ReadonlyArray<SavedSkillSource>;
  readonly disabled: boolean;
  readonly onPick: (source: string) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Saved:</span>
      {sources.map((saved) => (
        <Button
          key={saved.id}
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled}
          title={saved.source}
          onClick={() => onPick(saved.source)}
        >
          {saved.label}
        </Button>
      ))}
    </div>
  );
}
