import { LOCAL_COMMENTS_FEATURE, LOCAL_FILES_FEATURE } from "@t3tools/shared/docsCloudLocal";

import { postToEmbedParent, subscribeParentMessages, useEmbedFeatures } from "../embedBridge.ts";
import { createLocalClient } from "./localClient.ts";

/** The T3 Code window's project files; only answers once it offered `local-files`. */
export const hostClient = createLocalClient({
  post: postToEmbedParent,
  subscribe: subscribeParentMessages,
});

/** Null before T3 Code's hello (or outside it), then whether it serves project files. */
export function useLocalFilesAvailable(): boolean | null {
  const features = useEmbedFeatures();
  if (features === null) return window.parent === window ? false : null;
  return features.includes(LOCAL_FILES_FEATURE);
}

/** Whether the T3 Code window also keeps comments on its project files. */
export function useLocalCommentsAvailable(): boolean {
  return !!useEmbedFeatures()?.includes(LOCAL_COMMENTS_FEATURE);
}
