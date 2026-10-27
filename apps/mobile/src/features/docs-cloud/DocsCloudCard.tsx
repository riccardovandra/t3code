import { useNavigation } from "@react-navigation/native";
import { docsCloudPath } from "@t3tools/client-runtime/docs-cloud";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { localDocAppPath } from "@t3tools/shared/docsCloudLocal";
import type { DocReference, DocsCloudReference } from "@t3tools/shared/toolOutput";
import { Keyboard, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useDocsCloudBaseUrl } from "./useDocsCloudBaseUrl";

/**
 * A doc an agent created in Docs Cloud, or a project file under docs/ it
 * opened. Opens in the app's Docs Cloud screen; a cloud doc on another Docs
 * Cloud opens in the browser.
 */
export function DocsCloudCard(props: {
  readonly environmentId: EnvironmentId;
  /** The conversation the card is in, so the screen can serve its project's files. */
  readonly threadId: ThreadId;
  readonly doc: DocsCloudReference | DocReference;
}) {
  const navigation = useNavigation();
  const baseUrl = useDocsCloudBaseUrl(props.environmentId);
  const { doc } = props;
  const projectFile = "docPath" in doc;
  const path = projectFile
    ? localDocAppPath(doc.docPath)
    : baseUrl === null
      ? null
      : docsCloudPath(doc.url, baseUrl);
  const title = projectFile ? doc.title : (doc.docTitle ?? doc.tabTitle);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      className="my-1 min-w-0 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-subtle"
      onPress={() => {
        if (path === null) {
          if (!projectFile) void tryOpenExternalUrl(doc.url, "docs-cloud");
          return;
        }
        Keyboard.dismiss();
        navigation.navigate("DocsCloud", {
          environmentId: String(props.environmentId),
          threadId: String(props.threadId),
          path,
          title,
        });
      }}
    >
      <View className="h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle">
        <SymbolView
          name={projectFile ? "doc.text" : "cloud"}
          size={18}
          tintColorClassName="accent-foreground-muted"
        />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-t3-medium text-sm text-foreground" numberOfLines={2}>
          {title}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {projectFile ? doc.docPath : "Docs Cloud"}
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
