import { docsCloudPath, docsCloudToolEvent } from "@t3tools/client-runtime/docs-cloud";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

/** The full URL for an app path on the configured Docs Cloud, or null when it would leave that origin. */
export function docsCloudUrl(baseUrl: string, path: string): string | null {
  try {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, baseUrl);
    return docsCloudPath(url.href, baseUrl) === null ? null : url.href;
  } catch {
    return null;
  }
}

/**
 * The doc screen stays on Docs Cloud: its pages load in place, web links open
 * in the system browser, and anything else (custom schemes, javascript:) is dropped.
 */
export function docsCloudNavigation(url: string, baseUrl: string): "load" | "external" | "block" {
  if (url === "about:blank" || docsCloudPath(url, baseUrl) !== null) return "load";
  return /^https?:\/\//i.test(url) ? "external" : "block";
}

export interface DocsCloudTabNotice {
  readonly id: string;
  readonly path: string;
  readonly tabTitle: string;
}

export interface DocsCloudTabsSeen {
  readonly key: string;
  readonly ids: ReadonlySet<string>;
}

/**
 * Tabs an agent added since this thread was first shown. Items present on the
 * first look are a baseline, so revisiting a thread never repeats a notice.
 */
export function freshDocsCloudTabs(
  previous: DocsCloudTabsSeen | null,
  key: string,
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  baseUrl: string,
): { readonly seen: DocsCloudTabsSeen; readonly fresh: ReadonlyArray<DocsCloudTabNotice> } {
  const tabs = items.flatMap(({ item }): DocsCloudTabNotice[] => {
    if (item.type !== "dynamic_tool") return [];
    const event = docsCloudToolEvent(item, baseUrl);
    return event?.kind === "tab-added"
      ? [{ id: item.id, path: event.path, tabTitle: event.ref.tabTitle }]
      : [];
  });
  if (previous?.key !== key) {
    return { seen: { key, ids: new Set(tabs.map((tab) => tab.id)) }, fresh: [] };
  }
  const fresh = tabs.filter((tab) => !previous.ids.has(tab.id));
  if (fresh.length === 0) return { seen: previous, fresh };
  return { seen: { key, ids: new Set([...previous.ids, ...fresh.map((tab) => tab.id)]) }, fresh };
}
