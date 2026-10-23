import { useCallback, useState } from "react";

import type { DocAnchor, StructuredAnchor } from "../../shared/anchors.ts";
import type { Comment, RoomMessage } from "../../shared/protocol.ts";
import { api } from "../api.ts";

type CommentMessage = Extract<RoomMessage, { type: `comment.${string}` }>;

export const isCommentMessage = (message: RoomMessage): message is CommentMessage =>
  message.type.startsWith("comment.");

/**
 * A doc's comments, kept current from REST responses and DocRoom pushes. Every
 * message is an idempotent upsert or delete, so our own echoes apply harmlessly.
 */
export function useComments(docId: string) {
  const [comments, setComments] = useState<ReadonlyMap<string, Comment>>(new Map());

  const upsert = useCallback((comment: Comment) => {
    setComments((current) => {
      const existing = current.get(comment.id);
      if (existing && existing.updatedAt > comment.updatedAt) return current;
      return new Map(current).set(comment.id, comment);
    });
  }, []);

  const remove = useCallback((ids: ReadonlyArray<string>) => {
    setComments((current) => {
      if (!ids.some((id) => current.has(id))) return current;
      const next = new Map(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const loaded = await api.comments(docId);
    setComments(new Map(loaded.comments.map((comment) => [comment.id, comment])));
  }, [docId]);

  const apply = useCallback(
    (message: CommentMessage) => {
      if (message.type === "comment.deleted") remove(message.commentIds);
      else upsert(message.comment);
    },
    [remove, upsert],
  );

  const actions = {
    create: async (
      tabId: string,
      anchor: DocAnchor,
      body: string,
      structured: StructuredAnchor | null = null,
    ) => {
      const { comment } = await api.createComment(tabId, {
        ...anchor,
        body,
        ...(structured ? { anchor: structured } : {}),
      });
      upsert(comment);
      return comment;
    },
    reply: async (commentId: string, body: string) =>
      upsert((await api.replyComment(commentId, body)).comment),
    setResolved: async (commentId: string, resolved: boolean) =>
      upsert((await api.setCommentResolved(commentId, resolved)).comment),
    delete: async (commentId: string) => remove((await api.deleteComment(commentId)).commentIds),
  };

  return { comments, load, apply, actions };
}

export type CommentActions = ReturnType<typeof useComments>["actions"];
