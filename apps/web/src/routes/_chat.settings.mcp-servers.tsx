import { createFileRoute } from "@tanstack/react-router";

import { McpServersSettings } from "../components/settings/McpServersSettings";

function SettingsMcpServersRoute() {
  const { add } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <McpServersSettings
      addRequested={add === true}
      onAddHandled={() =>
        void navigate({ search: ({ add: _add, ...rest }) => rest, replace: true })
      }
    />
  );
}

export const Route = createFileRoute("/_chat/settings/mcp-servers")({
  validateSearch: (raw: Record<string, unknown>): { add?: true } =>
    raw.add === true || raw.add === "true" ? { add: true } : {},
  component: SettingsMcpServersRoute,
});
