import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { serverEnvironment } from "./server";

// Fork: which release-mirror servers already have this version on their mirror. Keyed by the
// version and the ids so an equal list reads the same atom across renders.
const releaseMirrorPublishedAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const [version = "", ...environmentIds] = key.split("\n") as [string, ...EnvironmentId[]];
    return environmentIds
      .filter((environmentId) =>
        AsyncResult.getOrElse(
          get(serverEnvironment.releaseMirrorPublished({ environmentId, input: { version } })),
          () => false,
        ),
      )
      .join("\n");
  }).pipe(Atom.withLabel(`release-mirror-published:${key}`)),
);

const NONE_ATOM = Atom.make("").pipe(Atom.withLabel("release-mirror-published:none"));

export function useReleaseMirrorPublished(
  version: string,
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlySet<EnvironmentId> {
  const published = useAtomValue(
    environmentIds.length === 0
      ? NONE_ATOM
      : releaseMirrorPublishedAtom([version, ...environmentIds].join("\n")),
  );
  return new Set(published === "" ? [] : (published.split("\n") as EnvironmentId[]));
}
