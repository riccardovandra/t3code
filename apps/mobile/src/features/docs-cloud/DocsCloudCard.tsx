import { useNavigation } from "@react-navigation/native";
import { docsCloudPath } from "@t3tools/client-runtime/docs-cloud";
import type { EnvironmentId } from "@t3tools/contracts";
import type { DocsCloudReference } from "@t3tools/shared/toolOutput";
import { Keyboard, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useDocsCloudBaseUrl } from "./useDocsCloudBaseUrl";

/** A doc an agent created in Docs Cloud. Opens in the app when it is this environment's Docs Cloud. */
export function DocsCloudCard(props: {
  readonly environmentId: EnvironmentId;
  readonly doc: DocsCloudReference;
}) {
  const navigation = useNavigation();
  const baseUrl = useDocsCloudBaseUrl(props.environmentId);
  const path = baseUrl === null ? null : docsCloudPath(props.doc.url, baseUrl);
  const title = props.doc.docTitle ?? props.doc.tabTitle;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      className="my-1 min-w-0 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-subtle"
      onPress={() => {
        if (path === null) {
          void tryOpenExternalUrl(props.doc.url, "docs-cloud");
          return;
        }
        Keyboard.dismiss();
        navigation.navigate("DocsCloud", {
          environmentId: String(props.environmentId),
          path,
          title,
        });
      }}
    >
      <View className="h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle">
        <SymbolView name="cloud" size={18} tintColorClassName="accent-foreground-muted" />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-t3-medium text-sm text-foreground" numberOfLines={2}>
          {title}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          Docs Cloud
        </Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={12}
        tintColorClassName="accent-foreground-muted"
        type="monochrome"
      />
    </Pressable>
  );
}
