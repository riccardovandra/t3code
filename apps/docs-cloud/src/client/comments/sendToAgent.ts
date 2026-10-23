import type { CommentThread } from "../../shared/threads.ts";

/** What a "Send to agent" handler receives for one thread. */
export interface ThreadForAgent {
  readonly docId: string;
  readonly docTitle: string;
  readonly tabId: string;
  readonly thread: CommentThread;
  /** Link that opens the doc at the thread's tab. */
  readonly url: string;
}

type Handler = (thread: ThreadForAgent) => void;

let handler: Handler | null = null;
const listeners = new Set<() => void>();

/**
 * The seam for sending a comment thread to a T3 Code agent thread. The embed
 * bridge installs a handler when T3 Code offers it; otherwise the button stays
 * hidden. Returns an unregister function.
 */
export function setSendToAgentHandler(next: Handler): () => void {
  handler = next;
  for (const listener of listeners) listener();
  return () => {
    if (handler !== next) return;
    handler = null;
    for (const listener of listeners) listener();
  };
}

export const hasSendToAgentHandler = () => handler !== null;

export function subscribeSendToAgent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sendThreadToAgent(thread: ThreadForAgent): void {
  handler?.(thread);
}
