import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useId, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { newMessageId, newThreadId } from "~/lib/utils";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import {
  useEnvironment,
  useEnvironmentProviders,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { primaryServerProvidersAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildCopyToClaudeDocPrompt,
  claudeDocInstances,
  type CopyToClaudeDocRequest,
  copyToClaudeDocThreadTitle,
} from "./copyToClaudeDoc";

function useClaudeInstances(environmentId: EnvironmentId, projectId: ProjectId | null) {
  const environment = useEnvironment(environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryProviders = useAtomValue(primaryServerProvidersAtom);
  const providers =
    useEnvironmentProviders().get(environmentId) ??
    (environmentId === primaryEnvironmentId ? primaryProviders : []);
  const settings = environment?.serverConfig?.settings ?? null;
  const derived = deriveProviderInstanceEntries(providers);
  const entries = settings ? applyProviderInstanceSettings(derived, settings, projectId) : derived;
  return {
    providers,
    settings,
    instances: claudeDocInstances(sortProviderInstanceEntries(entries)),
  };
}

/** Picks a Claude account, then starts a thread that recreates the doc in Claude Docs. */
export function CopyToClaudeDocDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly request: CopyToClaudeDocRequest;
  readonly onClose: () => void;
}) {
  const { environmentId, projectId, request, onClose } = props;
  const id = useId();
  const navigate = useNavigate();
  const { providers, settings, instances } = useClaudeInstances(environmentId, projectId);
  const [remembered, setRemembered] = useLocalStorage(
    `t3code:docs-cloud:copy-to-claude-doc:${environmentId}:${projectId ?? "none"}`,
    "",
    Schema.String,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, "copy to Claude Doc");
  const selected =
    instances.find((entry) => entry.instanceId === (picked ?? remembered)) ?? instances[0];

  const start = async () => {
    if (!selected || projectId === null) return;
    const model = getDefaultProviderInstanceModel(providers, selected.instanceId);
    if (!model) return;
    const modelSelection = { instanceId: selected.instanceId, model };
    const runtimeMode = settings
      ? resolveProjectSettings(settings, projectId).settings.defaultRuntimeMode
      : DEFAULT_RUNTIME_MODE;
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    setStarting(true);
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: buildCopyToClaudeDocPrompt(request),
          attachments: [],
        },
        modelSelection,
        runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId,
            title: copyToClaudeDocThreadTitle(request),
            modelSelection,
            runtimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    setStarting(false);
    if (result._tag !== "Success") return;
    setRemembered(selected.instanceId);
    onClose();
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Copying to Claude Docs",
        description: `${selected.displayName} replies with the Claude Doc link when it is done.`,
        actionProps: {
          children: "Open thread",
          onClick: () =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
            }),
        },
      }),
    );
  };

  const blocker =
    projectId === null
      ? "Open Docs Cloud from a project thread to copy a doc."
      : instances.length === 0
        ? "No Claude provider is enabled for this project. Enable one in Settings, then try again."
        : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <DialogHeader>
            <DialogTitle>Copy to Claude Doc</DialogTitle>
            <DialogDescription>
              A new thread recreates “{request.title}” in Claude Docs with the account you pick.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {blocker ? (
              <p className="text-muted-foreground">{blocker}</p>
            ) : (
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-instance`}>
                Claude account
                <Select
                  value={selected?.instanceId ?? null}
                  items={Object.fromEntries(
                    instances.map((entry) => [entry.instanceId, entry.displayName]),
                  )}
                  onValueChange={(value) => {
                    if (typeof value === "string") setPicked(value);
                  }}
                >
                  <SelectTrigger id={`${id}-instance`} className="min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {instances.map((entry) => (
                      <SelectItem key={entry.instanceId} value={entry.instanceId}>
                        {entry.displayName}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Label>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={blocker !== null || starting}>
              Copy
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
