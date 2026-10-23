import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Tab } from "../../shared/protocol.ts";
import { countDescendants, moveTarget, orderTabs, type TabMove } from "./tabTree.ts";

const MOVES: ReadonlyArray<{ readonly move: TabMove; readonly label: string }> = [
  { move: "up", label: "Move up" },
  { move: "down", label: "Move down" },
  { move: "indent", label: "Indent" },
  { move: "outdent", label: "Outdent" },
];

/** Left rail with the doc's tab tree: child tabs, collapse, rename, reorder and delete. */
export function TabRail(props: {
  readonly tabs: ReadonlyArray<Tab>;
  readonly activeTabId: string | null;
  readonly onSelect: (tabId: string) => void;
  readonly onCreate: (parentTabId: string | null) => void;
  readonly onRename: (tabId: string, title: string) => void;
  readonly onMove: (tabId: string, parentTabId: string | null, position: number) => void;
  readonly onDelete: (tabId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menuTabId, setMenuTabId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const ordered = orderTabs(props.tabs);
  const parentIds = new Set(props.tabs.map((tab) => tab.parentTabId));
  const visible: Array<(typeof ordered)[number]> = [];
  let hiddenBelow = Number.POSITIVE_INFINITY;
  for (const item of ordered) {
    if (item.depth > hiddenBelow) continue;
    hiddenBelow = collapsed.has(item.tab.id) ? item.depth : Number.POSITIVE_INFINITY;
    visible.push(item);
  }

  const setExpanded = (tabId: string, expanded: boolean) =>
    setCollapsed((current) => {
      if (current.has(tabId) !== expanded) return current;
      const next = new Set(current);
      if (expanded) next.delete(tabId);
      else next.add(tabId);
      return next;
    });

  const confirmDelete = (tab: Tab) => {
    const descendants = countDescendants(props.tabs, tab.id);
    const extra =
      descendants > 0 ? ` and its ${descendants} sub-tab${descendants === 1 ? "" : "s"}` : "";
    if (window.confirm(`Delete "${tab.title}"${extra}?`)) props.onDelete(tab.id);
  };

  return (
    <nav className="tab-rail" aria-label="Tabs">
      <ul role="tree">
        {visible.map(({ tab, depth }) => {
          const hasChildren = parentIds.has(tab.id);
          const expanded = hasChildren && !collapsed.has(tab.id);
          const active = tab.id === props.activeTabId;
          return (
            <li
              key={tab.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={active}
              {...(hasChildren ? { "aria-expanded": expanded } : {})}
              className={active ? "tab-row active" : "tab-row"}
              style={{ paddingLeft: `${depth}rem` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="tab-row-toggle"
                  aria-label={expanded ? "Collapse" : "Expand"}
                  onClick={() => setExpanded(tab.id, !expanded)}
                >
                  {expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="tab-row-toggle" aria-hidden="true" />
              )}
              {renamingTabId === tab.id ? (
                <RenameInput
                  title={tab.title}
                  onDone={(title) => {
                    setRenamingTabId(null);
                    if (title && title !== tab.title) props.onRename(tab.id, title);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="tab-rail-item"
                  onClick={() => props.onSelect(tab.id)}
                  onDoubleClick={() => setRenamingTabId(tab.id)}
                >
                  {tab.title}
                </button>
              )}
              <button
                type="button"
                className="tab-row-menu-button"
                aria-label={`Actions for ${tab.title}`}
                aria-haspopup="menu"
                aria-expanded={menuTabId === tab.id}
                onClick={() => setMenuTabId(menuTabId === tab.id ? null : tab.id)}
              >
                ⋯
              </button>
              {menuTabId === tab.id ? (
                <TabMenu onClose={() => setMenuTabId(null)}>
                  <MenuItem
                    label="Add child tab"
                    onSelect={() => {
                      setExpanded(tab.id, true);
                      props.onCreate(tab.id);
                    }}
                  />
                  <MenuItem label="Rename" onSelect={() => setRenamingTabId(tab.id)} />
                  {MOVES.map(({ move, label }) => {
                    const target = moveTarget(props.tabs, tab.id, move);
                    return (
                      <MenuItem
                        key={move}
                        label={label}
                        disabled={target === null}
                        onSelect={() => {
                          if (!target) return;
                          if (target.parentTabId) setExpanded(target.parentTabId, true);
                          props.onMove(tab.id, target.parentTabId, target.position);
                        }}
                      />
                    );
                  })}
                  <MenuItem label="Delete" danger onSelect={() => confirmDelete(tab)} />
                </TabMenu>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button type="button" className="tab-rail-new" onClick={() => props.onCreate(null)}>
        New tab…
      </button>
    </nav>
  );
}

function RenameInput(props: { readonly title: string; readonly onDone: (title: string) => void }) {
  const done = useRef(false);
  const finish = (title: string) => {
    if (done.current) return;
    done.current = true;
    props.onDone(title.trim());
  };
  return (
    <input
      className="tab-rename"
      aria-label="Tab title"
      defaultValue={props.title}
      maxLength={200}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish("");
      }}
    />
  );
}

function TabMenu(props: { readonly onClose: () => void; readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  useLayoutEffect(() => {
    onClose.current = props.onClose;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const row = ref.current?.parentElement;
      if (row && !row.contains(event.target as Node)) onClose.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="tab-menu"
      role="menu"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button:not(:disabled)")) props.onClose();
      }}
    >
      {props.children}
    </div>
  );
}

function MenuItem(props: {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={props.danger ? "tab-menu-item danger" : "tab-menu-item"}
      disabled={props.disabled}
      onClick={props.onSelect}
    >
      {props.label}
    </button>
  );
}
