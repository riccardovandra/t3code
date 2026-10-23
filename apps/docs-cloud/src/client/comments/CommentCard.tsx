import { useState, type KeyboardEvent } from "react";

import type { Comment } from "../../shared/protocol.ts";
import { AGENT_AUTHOR_PREFIX, isAgentAuthor, type CommentThread } from "../../shared/threads.ts";

export const authorLabel = (author: string) =>
  isAgentAuthor(author) ? author.slice(AGENT_AUTHOR_PREFIX.length) : "You";

const formatTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function CommentEntry(props: { readonly comment: Comment; readonly onDelete?: () => void }) {
  return (
    <div className="comment-entry">
      <div className="comment-meta">
        <span
          className={
            isAgentAuthor(props.comment.author) ? "comment-author agent" : "comment-author"
          }
        >
          {authorLabel(props.comment.author)}
        </span>
        <span className="muted">{formatTime(props.comment.createdAt)}</span>
        {props.onDelete ? (
          <button
            type="button"
            className="link-button comment-entry-delete"
            onClick={props.onDelete}
          >
            Delete
          </button>
        ) : null}
      </div>
      <p className="comment-body">{props.comment.body}</p>
    </div>
  );
}

/** A textarea that submits on Cmd/Ctrl+Enter and cancels on Escape. */
export function CommentComposer(props: {
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly autoFocus?: boolean;
  readonly onSubmit: (body: string) => Promise<unknown>;
  readonly onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await props.onSubmit(text);
      setBody("");
    } catch {
      // The page reports the failure; the text stays so it can be resent.
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      props.onCancel?.();
    }
  };
  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        value={body}
        rows={2}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        autoFocus={props.autoFocus}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="comment-actions">
        <button type="submit" className="button small" disabled={busy || !body.trim()}>
          {props.submitLabel}
        </button>
        {props.onCancel ? (
          <button type="button" className="link-button" onClick={props.onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

export interface ThreadHandlers {
  readonly onReply: (body: string) => Promise<unknown>;
  readonly onResolve: () => void;
  readonly onDelete: (commentId: string) => void;
  /** Present only when a "Send to agent" handler is installed. */
  readonly onSendToAgent?: () => void;
}

/** One thread in the margin. Inactive cards stay compact; the active one shows replies and actions. */
export function CommentCard(
  props: ThreadHandlers & {
    readonly thread: CommentThread;
    readonly anchored: boolean;
    readonly active: boolean;
    readonly onActivate: () => void;
  },
) {
  const { root, replies } = props.thread;
  return (
    <article
      className={props.active ? "comment-card active" : "comment-card"}
      data-comment-id={root.id}
      onClick={props.active ? undefined : props.onActivate}
    >
      {props.anchored ? null : (
        <p className="comment-detached">
          {root.anchor ? "Removed from the table" : "Text removed"}
          {root.quote ? (
            <>
              : <q>{root.quote}</q>
            </>
          ) : null}
        </p>
      )}
      <CommentEntry comment={root} />
      {props.active ? (
        <>
          {replies.map((reply) => (
            <CommentEntry
              key={reply.id}
              comment={reply}
              onDelete={() => props.onDelete(reply.id)}
            />
          ))}
          <CommentComposer placeholder="Reply" submitLabel="Reply" onSubmit={props.onReply} />
          <div className="comment-actions">
            <button type="button" className="link-button" onClick={props.onResolve}>
              Resolve
            </button>
            {props.onSendToAgent ? (
              <button type="button" className="link-button" onClick={props.onSendToAgent}>
                Send to agent
              </button>
            ) : null}
            <button
              type="button"
              className="link-button danger"
              onClick={() => props.onDelete(root.id)}
            >
              Delete thread
            </button>
          </div>
        </>
      ) : replies.length > 0 ? (
        <p className="comment-reply-count muted">
          {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
        </p>
      ) : null}
    </article>
  );
}
