import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import {
  MCP_SERVERS_UNSUPPORTED_MESSAGE,
  mcpServerAuthAction,
  mcpServerStatusPresentation,
  mcpServerTransportSummary,
} from "@t3tools/client-runtime/mcp-servers";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { McpServerEntry } from "@t3tools/contracts";
import { useState } from "react";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "./components/SettingsActionRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";

export function SettingsMcpServersRouteScreen() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const insets = useSafeAreaInsets();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="MCP servers" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScreenScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length === 0 ? (
            <Text className="text-foreground-muted">Select a connected environment.</Text>
          ) : (
            selectedTargets.map((environment) => (
              <EnvironmentMcpServers key={environment.environmentId} environment={environment} />
            ))
          )}
          <Text className="px-2 text-sm text-foreground-muted">
            Add and edit servers in web or desktop Settings. Changes apply to threads started
            afterwards.
          </Text>
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function EnvironmentMcpServers({ environment }: { readonly environment: SettingsTarget }) {
  return (
    <SettingsSection title={environment.label}>
      {environment.serverConfig.environment.capabilities.mcpServers === true ? (
        <EnvironmentMcpServerList environment={environment} />
      ) : (
        <Text className="p-4 text-base text-foreground-muted">
          {MCP_SERVERS_UNSUPPORTED_MESSAGE}
        </Text>
      )}
    </SettingsSection>
  );
}

function EnvironmentMcpServerList({ environment }: { readonly environment: SettingsTarget }) {
  const environmentId = environment.environmentId;
  const servers = useEnvironmentQuery(
    serverEnvironment.mcpServersLive({ environmentId, input: {} }),
  );
  const canWrite = useAtomValue(serverEnvironment.upsertMcpServer.permissionAtom(environmentId));
  return (
    <>
      {servers.error ? (
        <Text className="p-4 text-base text-danger-foreground">{servers.error}</Text>
      ) : !servers.data ? (
        <Text className="p-4 text-base text-foreground-muted">Loading servers…</Text>
      ) : servers.data.servers.length === 0 ? (
        <Text className="p-4 text-base text-foreground-muted">No MCP servers yet.</Text>
      ) : (
        servers.data.servers.map((entry) => (
          <McpServer key={entry.id} environment={environment} entry={entry} canWrite={canWrite} />
        ))
      )}
    </>
  );
}

const STATUS_TEXT_CLASS = {
  success: "text-foreground",
  warning: "text-warning-foreground",
  error: "text-danger-foreground",
  muted: "text-foreground-muted",
} as const;

function McpServer({
  environment,
  entry,
  canWrite,
}: {
  readonly environment: SettingsTarget;
  readonly entry: McpServerEntry;
  readonly canWrite: boolean;
}) {
  const environmentId = environment.environmentId;
  const options = { reportFailure: false, reportDefect: false };
  const setEnabled = useAtomCommand(serverEnvironment.setMcpServerEnabled, options);
  const startSignIn = useAtomCommand(serverEnvironment.startMcpServerSignIn, options);
  const signOut = useAtomCommand(serverEnvironment.signOutMcpServer, options);
  const remove = useAtomCommand(serverEnvironment.removeMcpServer, options);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = mcpServerStatusPresentation(entry.status);
  const authAction = mcpServerAuthAction(entry);
  const input = { id: entry.id };
  const disabled = pending || !canWrite;

  async function run<A>(command: () => Promise<AtomCommandResult<A, unknown>>) {
    if (pending) return null;
    setPending(true);
    setError(null);
    const result = await command();
    setPending(false);
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not update this server.");
    }
    return null;
  }

  return (
    <View className="border-b border-border-subtle">
      <View className="flex-row items-start gap-3 p-4">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-lg font-semibold text-foreground">{entry.name}</Text>
          <Text numberOfLines={1} className="font-mono text-sm text-foreground-muted">
            {mcpServerTransportSummary(entry)}
          </Text>
          <Text accessibilityLiveRegion="polite" className={STATUS_TEXT_CLASS[status.tone]}>
            {status.detail ? `${status.label} · ${status.detail}` : status.label}
          </Text>
          {error ? (
            <Text accessibilityRole="alert" className="text-danger-foreground">
              {error}
            </Text>
          ) : null}
        </View>
        <ThemedSwitch
          accessibilityLabel={`Enable ${entry.name}`}
          disabled={disabled}
          value={entry.enabled}
          onValueChange={(enabled) => {
            void run(() => setEnabled({ environmentId, input: { id: entry.id, enabled } }));
          }}
        />
      </View>
      {authAction !== null && entry.enabled ? (
        <SettingsActionRow
          icon="globe"
          label={authAction === "sign-in" ? "Sign in" : "Sign in again"}
          disabled={disabled}
          loading={pending}
          onPress={() => {
            void run(() => startSignIn({ environmentId, input })).then((result) => {
              if (result === null) return;
              Linking.openURL(result.authorizationUrl).catch(() =>
                setError("Could not open the sign-in page."),
              );
            });
          }}
        />
      ) : null}
      {authAction === "sign-out" ? (
        <SettingsActionRow
          icon="person.crop.circle"
          label="Sign out"
          tone="danger"
          disabled={disabled}
          onPress={() => {
            void run(() => signOut({ environmentId, input }));
          }}
        />
      ) : null}
      <SettingsActionRow
        icon="trash"
        label="Remove"
        tone="danger"
        disabled={disabled}
        onPress={() =>
          Dialog.alert(
            `Remove ${entry.name}?`,
            `Its stored credentials on ${environment.label} are deleted, and new threads stop seeing its tools.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove",
                style: "destructive",
                onPress: () => {
                  void run(() => remove({ environmentId, input }));
                },
              },
            ],
          )
        }
      />
    </View>
  );
}
