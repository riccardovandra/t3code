import { useEffect, useState } from "react";

import { api } from "./api.ts";
import { setMe, useMe } from "./me.ts";
import { DocPage } from "./pages/DocPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { navigate, parseRoute, usePathname } from "./router.ts";
import { displayName } from "../shared/access.ts";

export function App() {
  const [loaded, setLoaded] = useState(false);
  const me = useMe();
  const route = parseRoute(usePathname());

  useEffect(() => {
    api
      .me()
      .then(setMe, () => setMe(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  if (!me) return <LoginPage onSignedIn={setMe} />;

  const signOut = async () => {
    await api.logout();
    setMe(null);
    navigate("/", { replace: true });
  };

  return (
    <div className="app">
      <header className="app-header">
        <a
          href="/"
          className="app-brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
        >
          Docs
        </a>
        <nav className="app-nav">
          <a
            href="/settings"
            onClick={(event) => {
              event.preventDefault();
              navigate("/settings");
            }}
          >
            Settings
          </a>
          <span className="muted">{displayName(me.user)}</span>
          <button type="button" className="link-button" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </header>
      {route.name === "library" ? <LibraryPage /> : null}
      {route.name === "settings" ? <SettingsPage /> : null}
      {route.name === "doc" ? (
        <DocPage key={route.docId} docId={route.docId} tabId={route.tabId} />
      ) : null}
    </div>
  );
}
