import { useSyncExternalStore } from "react";

let projectName: string | null = null;
const listeners = new Set<() => void>();

/** The T3 Code project whose Docs panel frames this app, or null outside T3 Code. */
export function setEmbedProjectName(next: string | null): void {
  if (next === projectName) return;
  projectName = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useEmbedProjectName(): string | null {
  return useSyncExternalStore(subscribe, () => projectName);
}
