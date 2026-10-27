import { docTitleFromPath } from "@t3tools/shared/docPaths";
import { useSyncExternalStore } from "react";

import { navigate, parseRoute, type Route } from "./router.ts";

/** A doc open in the tab strip. `path` is where it was last, in-doc tab included. */
export interface OpenTab {
  readonly key: string;
  readonly path: string;
  readonly title: string;
}

export function openTabKey(route: Route): string | null {
  if (route.name === "doc") return `doc:${route.docId}`;
  if (route.name === "local") return `local:${route.path}`;
  return null;
}

/** Records a visit to `path`: adds its doc as a tab, or moves that tab to it. */
export function visitTab(tabs: ReadonlyArray<OpenTab>, path: string): ReadonlyArray<OpenTab> {
  const route = parseRoute(path);
  const key = openTabKey(route);
  if (key === null) return tabs;
  const index = tabs.findIndex((tab) => tab.key === key);
  if (index === -1) {
    const title = route.name === "local" ? docTitleFromPath(route.path) : "Untitled";
    return [...tabs, { key, path, title }];
  }
  if (tabs[index]!.path === path) return tabs;
  return tabs.with(index, { ...tabs[index]!, path });
}

export function retitleTab(
  tabs: ReadonlyArray<OpenTab>,
  key: string,
  title: string,
): ReadonlyArray<OpenTab> {
  const index = tabs.findIndex((tab) => tab.key === key);
  if (index === -1 || tabs[index]!.title === title) return tabs;
  return tabs.with(index, { ...tabs[index]!, title });
}

/**
 * Removes a tab. Closing the active one moves to its right-hand neighbour,
 * else its left, else home; closing another tab stays put (`next` is null).
 */
export function closeTab(
  tabs: ReadonlyArray<OpenTab>,
  key: string,
  activeKey: string | null,
): { readonly tabs: ReadonlyArray<OpenTab>; readonly next: string | null } {
  const index = tabs.findIndex((tab) => tab.key === key);
  if (index === -1) return { tabs, next: null };
  const rest = tabs.toSpliced(index, 1);
  if (key !== activeKey) return { tabs: rest, next: null };
  return { tabs: rest, next: rest[Math.min(index, rest.length - 1)]?.path ?? "/" };
}

export function parseOpenTabs(raw: string | null): ReadonlyArray<OpenTab> {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (tab): tab is OpenTab =>
        typeof tab?.key === "string" &&
        typeof tab.path === "string" &&
        typeof tab.title === "string" &&
        openTabKey(parseRoute(tab.path)) === tab.key,
    );
  } catch {
    return [];
  }
}

// Remembered per browser; the embedded panel and a browser tab share it.
const STORAGE_KEY = "docs-cloud:open-tabs";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let current: ReadonlyArray<OpenTab> | null = null;
const listeners = new Set<() => void>();

function read(): ReadonlyArray<OpenTab> {
  current ??= parseOpenTabs(storage()?.getItem(STORAGE_KEY) ?? null);
  return current;
}

function write(next: ReadonlyArray<OpenTab>): void {
  if (next === read()) return;
  current = next;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private modes can refuse storage; the tabs still last until reload.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useOpenTabs(): ReadonlyArray<OpenTab> {
  return useSyncExternalStore(subscribe, read);
}

/** Adds or updates the tab for `path` without navigating, e.g. for a background tab. */
export const rememberTab = (path: string) => write(visitTab(read(), path));

export const setDocTabTitle = (docId: string, title: string) =>
  write(retitleTab(read(), `doc:${docId}`, title));

export function closeOpenTab(key: string): void {
  const active = openTabKey(parseRoute(window.location.pathname));
  const { tabs, next } = closeTab(read(), key, active);
  write(tabs);
  if (next !== null) navigate(next);
}

/** The doc is gone or out of reach: drop its tab and go home. */
export function leaveDoc(docId: string): void {
  write(closeTab(read(), `doc:${docId}`, null).tabs);
  navigate("/", { replace: true });
}
