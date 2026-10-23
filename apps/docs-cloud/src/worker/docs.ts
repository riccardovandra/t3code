// Doc and tab service functions. The REST API, the DocRoom and the future
// `/mcp` endpoint all call these, so every surface shares one behaviour.
// Writes to an existing doc must go through the DocRoom (see `rooms.ts`) so
// open editors hear about them; these functions only touch D1.

import type {
  DocStatus,
  DocSummary,
  DocWithTabs,
  LibraryProject,
  Project,
  Tab,
} from "../shared/protocol.ts";
import { randomId } from "./crypto.ts";

interface DocRow {
  id: string;
  project_id: string;
  title: string;
  status: DocStatus;
  created_at: number;
  updated_at: number;
}

interface TabRow {
  id: string;
  doc_id: string;
  parent_tab_id: string | null;
  position: number;
  title: string;
  markdown: string;
  version: number;
  updated_at: number;
}

const toDoc = (row: DocRow): DocSummary => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTab = (row: TabRow): Tab => ({
  id: row.id,
  docId: row.doc_id,
  parentTabId: row.parent_tab_id,
  position: row.position,
  title: row.title,
  markdown: row.markdown,
  version: row.version,
  updatedAt: row.updated_at,
});

export class NotFoundError extends Error {}

export async function listLibrary(db: D1Database): Promise<ReadonlyArray<LibraryProject>> {
  const [projects, docs] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT id, name, created_at FROM projects ORDER BY name COLLATE NOCASE"),
    db.prepare("SELECT * FROM docs ORDER BY updated_at DESC"),
  ]);
  const docsByProject = new Map<string, Array<DocSummary>>();
  for (const row of (docs?.results ?? []) as unknown as Array<DocRow>) {
    const list = docsByProject.get(row.project_id) ?? [];
    list.push(toDoc(row));
    docsByProject.set(row.project_id, list);
  }
  return (
    (projects?.results ?? []) as unknown as Array<{ id: string; name: string; created_at: number }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    docs: docsByProject.get(row.id) ?? [],
  }));
}

export async function createProject(db: D1Database, name: string, now: number): Promise<Project> {
  const project = { id: randomId(), name, createdAt: now };
  await db
    .prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)")
    .bind(project.id, project.name, now)
    .run();
  return project;
}

/** Creates a doc with one empty top-level tab. */
export async function createDoc(
  db: D1Database,
  input: { readonly projectId: string; readonly title: string; readonly now: number },
): Promise<DocWithTabs> {
  const project = await db
    .prepare("SELECT id FROM projects WHERE id = ?")
    .bind(input.projectId)
    .first();
  if (!project) throw new NotFoundError("project");
  const doc: DocSummary = {
    id: randomId(),
    projectId: input.projectId,
    title: input.title,
    status: "thinking",
    createdAt: input.now,
    updatedAt: input.now,
  };
  const tab: Tab = {
    id: randomId(),
    docId: doc.id,
    parentTabId: null,
    position: 0,
    title: input.title,
    markdown: "",
    version: 1,
    updatedAt: input.now,
  };
  await db.batch([
    db
      .prepare(
        "INSERT INTO docs (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(doc.id, doc.projectId, doc.title, doc.status, doc.createdAt, doc.updatedAt),
    insertTabStatement(db, tab),
  ]);
  return { doc, tabs: [tab] };
}

export async function getDoc(db: D1Database, docId: string): Promise<DocWithTabs> {
  const [docs, tabs] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT * FROM docs WHERE id = ?").bind(docId),
    db.prepare("SELECT * FROM tabs WHERE doc_id = ? ORDER BY position, updated_at").bind(docId),
  ]);
  const doc = docs?.results[0] as unknown as DocRow | undefined;
  if (!doc) throw new NotFoundError("doc");
  return { doc: toDoc(doc), tabs: ((tabs?.results ?? []) as unknown as Array<TabRow>).map(toTab) };
}

export async function getTab(db: D1Database, tabId: string): Promise<Tab> {
  const row = await db.prepare("SELECT * FROM tabs WHERE id = ?").bind(tabId).first<TabRow>();
  if (!row) throw new NotFoundError("tab");
  return toTab(row);
}

/** A tab's markdown, the unit agents read and export works from. */
export async function getTabMarkdown(db: D1Database, tabId: string): Promise<string> {
  return (await getTab(db, tabId)).markdown;
}

function insertTabStatement(db: D1Database, tab: Tab) {
  return db
    .prepare(
      `INSERT INTO tabs (id, doc_id, parent_tab_id, position, title, markdown, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tab.id,
      tab.docId,
      tab.parentTabId,
      tab.position,
      tab.title,
      tab.markdown,
      tab.version,
      tab.updatedAt,
    );
}

function touchDocStatement(db: D1Database, docId: string, now: number) {
  return db.prepare("UPDATE docs SET updated_at = ? WHERE id = ?").bind(now, docId);
}

/** Appends a tab after its siblings. Call through the DocRoom. */
export async function createTab(
  db: D1Database,
  input: {
    readonly docId: string;
    readonly parentTabId: string | null;
    readonly title: string;
    readonly markdown: string;
    readonly now: number;
  },
): Promise<Tab> {
  if (input.parentTabId !== null) {
    const parent = await getTab(db, input.parentTabId);
    if (parent.docId !== input.docId) throw new NotFoundError("tab");
  }
  const last = await db
    .prepare("SELECT MAX(position) AS position FROM tabs WHERE doc_id = ? AND parent_tab_id IS ?")
    .bind(input.docId, input.parentTabId)
    .first<{ position: number | null }>();
  const tab: Tab = {
    id: randomId(),
    docId: input.docId,
    parentTabId: input.parentTabId,
    position: (last?.position ?? -1) + 1,
    title: input.title,
    markdown: input.markdown,
    version: 1,
    updatedAt: input.now,
  };
  await db.batch([insertTabStatement(db, tab), touchDocStatement(db, input.docId, input.now)]);
  return tab;
}

export type TabWriteResult =
  | { readonly ok: true; readonly tab: Tab }
  | { readonly ok: false; readonly conflict: Tab };

/**
 * Applies a write only when the caller saw the current version. A stale
 * `baseVersion` returns the current tab so the caller can reload it. Call
 * through the DocRoom so the write is ordered and broadcast.
 */
export async function writeTab(
  db: D1Database,
  input: {
    readonly tabId: string;
    readonly baseVersion: number;
    readonly markdown?: string;
    readonly title?: string;
    readonly now: number;
  },
): Promise<TabWriteResult> {
  const updated = await db
    .prepare(
      `UPDATE tabs SET markdown = COALESCE(?, markdown), title = COALESCE(?, title),
         version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?
       RETURNING *`,
    )
    .bind(input.markdown ?? null, input.title ?? null, input.now, input.tabId, input.baseVersion)
    .first<TabRow>();
  if (!updated) return { ok: false, conflict: await getTab(db, input.tabId) };
  await touchDocStatement(db, updated.doc_id, input.now).run();
  return { ok: true, tab: toTab(updated) };
}
