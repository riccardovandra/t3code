// Wire types shared by the Worker, the DocRoom socket and the SPA.

export type DocStatus = "thinking" | "plan" | "in_progress" | "done";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

export interface DocSummary {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: DocStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Tab {
  readonly id: string;
  readonly docId: string;
  readonly parentTabId: string | null;
  readonly position: number;
  readonly title: string;
  readonly markdown: string;
  readonly version: number;
  readonly updatedAt: number;
}

export interface LibraryProject extends Project {
  readonly docs: ReadonlyArray<DocSummary>;
}

export interface DocWithTabs {
  readonly doc: DocSummary;
  readonly tabs: ReadonlyArray<Tab>;
}

export interface ApiTokenSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
}

/** Where a tab sits in its doc's tree. */
export interface TabPlacement {
  readonly tabId: string;
  readonly parentTabId: string | null;
  readonly position: number;
}

/**
 * A comment on a tab. A thread is a root (`parentId` null) carrying the anchor
 * and resolve state, plus its replies in creation order. `author` is an owner
 * email or `agent:<name>`.
 */
export interface Comment {
  readonly id: string;
  readonly docId: string;
  readonly tabId: string;
  readonly parentId: string | null;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly body: string;
  readonly author: string;
  readonly resolvedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * DocRoom -> editor messages over `GET /api/docs/:docId/ws`. Clients never send
 * writes over the socket; they go through the REST API so agents and editors
 * share one path. `origin` is the `clientId` the writer passed, so an editor can
 * recognise its own echo.
 */
export type RoomMessage =
  | { readonly type: "tab.created"; readonly tab: Tab; readonly origin: string | null }
  | { readonly type: "tab.updated"; readonly tab: Tab; readonly origin: string | null }
  | {
      readonly type: "tab.moved";
      readonly placements: ReadonlyArray<TabPlacement>;
      readonly origin: string | null;
    }
  | {
      readonly type: "tab.deleted";
      readonly tabIds: ReadonlyArray<string>;
      readonly placements: ReadonlyArray<TabPlacement>;
      readonly origin: string | null;
    }
  | { readonly type: "doc.updated"; readonly doc: DocSummary; readonly origin: string | null }
  | { readonly type: "comment.created"; readonly comment: Comment; readonly origin: string | null }
  | { readonly type: "comment.updated"; readonly comment: Comment; readonly origin: string | null }
  | {
      readonly type: "comment.deleted";
      /** The comment and, for a thread root, its replies. */
      readonly commentIds: ReadonlyArray<string>;
      readonly origin: string | null;
    };
