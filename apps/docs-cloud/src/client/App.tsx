import { useEffect, useState } from "react";

import { api } from "./api.ts";
import { DocPage } from "./pages/DocPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { navigate, parseRoute, usePathname } from "./router.ts";

type Session =
  | { readonly state: "loading" }
  | { readonly state: "signedOut" }
  | {
      readonly state: "signedIn";
      readonly email: string;
    };

export function App() {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const route = parseRoute(usePathname());

  useEffect(() => {
    api.me().then(
      (me) => setSession({ state: "signedIn", email: me.email }),
      () => setSession({ state: "signedOut" }),
    );
  }, []);

  if (session.state === "loading") return null;
  if (session.state === "signedOut") {
    return <LoginPage onSignedIn={(email) => setSession({ state: "signedIn", email })} />;
  }

  const signOut = async () => {
    await api.logout();
    setSession({ state: "signedOut" });
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
          <span className="muted">{session.email}</span>
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
