import { createFileRoute } from "@tanstack/react-router";

import { AiPmPage } from "../components/aiPm/AiPmPage";

export const Route = createFileRoute("/_chat/ai-pm")({
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === "string" ? search.project : undefined,
    environment: typeof search.environment === "string" ? search.environment : undefined,
  }),
  component: AiPmRoute,
});

function AiPmRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AiPmPage
      projectId={search.project}
      environmentId={search.environment}
      onSelectProject={(project) => void navigate({ search: { ...search, project } })}
      onSelectEnvironment={(environment) =>
        void navigate({ search: { environment, project: undefined } })
      }
    />
  );
}
