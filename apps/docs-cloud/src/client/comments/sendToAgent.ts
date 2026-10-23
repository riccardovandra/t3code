import type { CommentThread } from "../../shared/threads.ts";

/** What a "Send to agent" handler receives for one thread. */
export interface ThreadForAgent {
  readonly docId: string;
  readonly tabId: string;
  readonly thread: CommentThread;
  /** Link that opens the doc at the thread's tab. */
  readonly url: string;
}

type Handler = (thread: ThreadForAgent) => void;

let handler: Handler | null = null;
const listeners = new Set<() => void>();

/**
 * The seam for sending a comment thread to a T3 Code agent thread. Nothing is
 * registered yet, so the button stays hidden; the T3 Code integration installs
 * a handler (for example one that posts to the embedding window). Returns an
 * unregister function.
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
