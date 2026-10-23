import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { mobileWebViewThemeColors } from "../../lib/htmlRenderTheme";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { docsCloudNavigation, docsCloudUrl } from "./docsCloudNavigation";
import { useDocsCloudBaseUrl } from "./useDocsCloudBaseUrl";

type DocsCloudScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  /** An app path such as `/d/<docId>/<tabId>`; the library when omitted. */
  readonly path?: string;
  readonly title?: string;
}>;

/**
 * Docs Cloud loads top-level here, so its own session cookie applies and the
 * first sign-in (email code) happens inside the page. The origin always comes
 * from the environment's MCP hub entry, never from the route.
 */
export function DocsCloudScreen({ route }: DocsCloudScreenProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const baseUrl = useDocsCloudBaseUrl(EnvironmentId.make(route.params.environmentId));
  const startUrl = baseUrl === null ? null : docsCloudUrl(baseUrl, route.params.path ?? "/");
  const [page, setPage] = useState<{ readonly url: string; readonly title: string } | null>(null);
  const currentUrl = page?.url ?? startUrl;
  const title = page?.title || route.params.title || "Docs Cloud";
  const webView = useRef<WebView<object>>(null);
  // Docs Cloud reads `window.t3DocsTheme` on load and takes later changes as a
  // `t3-docs:theme` message posted from the page itself.
  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  const themeScript = useMemo(() => {
    const theme = {
      type: "t3-docs:theme",
      appearance: themeAppearance,
      colors: mobileWebViewThemeColors({
        themeId,
        appearance: themeAppearance,
        variables: themeVariables,
        systemColors: systemColorsActive,
        platform: Platform.OS,
      }),
    };
    return `window.t3DocsTheme=${JSON.stringify(theme)};`;
  }, [themeId, themeAppearance, themeVariables, systemColorsActive]);
  useEffect(() => {
    webView.current?.injectJavaScript(
      `${themeScript}window.postMessage(window.t3DocsTheme, location.origin);true;`,
    );
  }, [themeScript]);

  return (
    <View className="flex-1 bg-screen" style={{ paddingTop: insets.top }}>
      <View className="h-11 flex-row items-center gap-3 px-3">
        <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open in browser"
          disabled={currentUrl === null}
          hitSlop={8}
          onPress={() => {
            if (currentUrl !== null) void WebBrowser.openBrowserAsync(currentUrl);
          }}
        >
          <SymbolView name="safari" size={18} tintColor="gray" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          onPress={() => navigation.goBack()}
        >
          <SymbolView name="xmark" size={18} tintColor="gray" />
        </Pressable>
      </View>
      <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
        {baseUrl === null || startUrl === null ? (
          <Text className="m-6 text-sm text-foreground-muted">
            Docs Cloud is not set up on this environment. Add it in Settings, MCP servers.
          </Text>
        ) : (
          <WebView
            ref={webView}
            source={{ uri: startUrl }}
            injectedJavaScriptBeforeContentLoaded={`${themeScript}true;`}
            originWhitelist={["http://*", "https://*", "about:*"]}
            allowsBackForwardNavigationGestures
            setSupportMultipleWindows={false}
            startInLoadingState
            onShouldStartLoadWithRequest={(request) => {
              // Frames inside a Docs Cloud page are its own business; the screen only guards its top level.
              if (request.isTopFrame === false) return true;
              const decision = docsCloudNavigation(request.url, baseUrl);
              if (decision === "external") void tryOpenExternalUrl(request.url, "docs-cloud");
              return decision === "load";
            }}
            onNavigationStateChange={(state) => {
              if (
                docsCloudNavigation(state.url, baseUrl) === "load" &&
                state.url !== "about:blank"
              ) {
                setPage({ url: state.url, title: state.title });
              }
            }}
            renderLoading={() => (
              <View className="absolute inset-0 items-center justify-center bg-screen">
                <AppActivityIndicator />
              </View>
            )}
            style={{ flex: 1, backgroundColor: "transparent" }}
          />
        )}
      </View>
    </View>
  );
}
