import { useEffect, useState } from "react";

import { api } from "./api.ts";
import { isEmbedded } from "./embedBridge.ts";
import { LocalDocPage } from "./local/LocalDocPage.tsx";
import { setMe, useMe } from "./me.ts";
import { DocPage } from "./pages/DocPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { OpenTabsStrip } from "./OpenTabsStrip.tsx";
import { useOpenTabs } from "./openTabs.ts";
import { parseRoute, usePathname } from "./router.ts";

export function App() {
  const [loaded, setLoaded] = useState(false);
  const me = useMe();
  const route = parseRoute(usePathname());
  const storedTabs = useOpenTabs();
  const openTabs = isEmbedded() ? storedTabs : [];

  useEffect(() => {
    api
      .me()
      .then(setMe, () => setMe(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  if (!me) return <LoginPage onSignedIn={setMe} />;

  // No app bar: home carries the account menu, and the doc header links back to home.
  return (
    <div className={openTabs.length > 0 ? "app has-open-tabs" : "app"}>
      {openTabs.length > 0 ? <OpenTabsStrip tabs={openTabs} route={route} /> : null}
      {route.name === "library" ? <LibraryPage /> : null}
      {route.name === "settings" ? <SettingsPage /> : null}
      {route.name === "doc" ? (
        <DocPage key={route.docId} docId={route.docId} tabId={route.tabId} />
      ) : null}
      {route.name === "local" ? <LocalDocPage key={route.path} path={route.path} /> : null}
    </div>
  );
}
