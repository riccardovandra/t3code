import type { Tab } from "../../shared/protocol.ts";
import { orderTabs } from "./tabTree.ts";

/**
 * Left rail listing the doc's tabs. S0 shows them flat in reading order; the
 * nested tab tree (child tabs, rename, reorder, delete) replaces this component.
 */
export function TabRail(props: {
  readonly tabs: ReadonlyArray<Tab>;
  readonly activeTabId: string | null;
  readonly onSelect: (tabId: string) => void;
  readonly onCreate: () => void;
}) {
  return (
    <nav className="tab-rail" aria-label="Tabs">
      <ul>
        {orderTabs(props.tabs).map(({ tab }) => (
          <li key={tab.id}>
            <button
              type="button"
              className={tab.id === props.activeTabId ? "tab-rail-item active" : "tab-rail-item"}
              onClick={() => props.onSelect(tab.id)}
            >
              {tab.title}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="tab-rail-new" onClick={props.onCreate}>
        + New tab
      </button>
    </nav>
  );
}
