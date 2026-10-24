import { useNavigation } from "@react-navigation/native";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { Toast } from "../../components/ui/Toast";
import { MOBILE_MOTION } from "../../lib/designTokens";
import { useThreadVisibleTurnItems } from "../../state/use-thread-detail";
import {
  type DocsCloudTabNotice as Notice,
  type DocsCloudTabsSeen,
  freshDocsCloudTabs,
} from "./docsCloudNavigation";
import { useDocsCloudBaseUrl } from "./useDocsCloudBaseUrl";

const NOTICE_DURATION_MS = 6000;

/** Announces a tab an agent adds to a Docs Cloud doc while this thread is open, like web's toast. */
export function DocsCloudTabNotice(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly agentName: string;
  readonly top: number;
}) {
  const { threadRef } = props;
  const navigation = useNavigation();
  const baseUrl = useDocsCloudBaseUrl(threadRef?.environmentId ?? null);
  const items = useThreadVisibleTurnItems({
    environmentId: threadRef?.environmentId ?? null,
    threadId: threadRef?.threadId ?? null,
  });
  const seen = useRef<DocsCloudTabsSeen | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (threadRef === null || baseUrl === null) return;
    const key = `${threadRef.environmentId}:${threadRef.threadId}:${baseUrl}`;
    const next = freshDocsCloudTabs(seen.current, key, items, baseUrl);
    seen.current = next.seen;
    const latest = next.fresh.at(-1);
    if (latest) setNotice(latest);
  }, [baseUrl, items, threadRef]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (notice === null || threadRef === null) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(MOBILE_MOTION.enter).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(MOBILE_MOTION.exit).reduceMotion(ReduceMotion.System)}
      className="absolute inset-x-3 z-[100]"
      style={{ top: props.top }}
      pointerEvents="box-none"
    >
      <Toast
        message={`${props.agentName} added a tab: ${notice.tabTitle}`}
        action={{
          label: "Open",
          onPress: () => {
            setNotice(null);
            navigation.navigate("DocsCloud", {
              environmentId: String(threadRef.environmentId),
              threadId: String(threadRef.threadId),
              path: notice.path,
              title: notice.tabTitle,
            });
          },
        }}
        onDismiss={() => setNotice(null)}
      />
    </Animated.View>
  );
}
