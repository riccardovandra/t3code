import type {
  DocComment,
  DocCommentAuthor,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { BotIcon, CheckIcon, EllipsisIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Textarea } from "../ui/textarea";
import type { DocAnchor } from "./docAnchors";

/** Remembered per doc, like Claude Docs' "Send to Claude" box. */
export function useSendToAgentPreference(projectId: ProjectId, docPath: string) {
  return useLocalStorage(`t3code:docs:send-to-agent:${projectId}:${docPath}`, true, Schema.Boolean);
}

interface CommentTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly docPath: string;
  /** The thread a comment can be sent to; null when there is no agent to ask. */
  readonly threadId: ThreadId | null;
}

export function DocCommentComposerCard(
  props: CommentTarget & {
    readonly anchor: DocAnchor;
    readonly onDone: (created: DocComment | null) => void;
  },
) {
  const create = useAtomCommand(serverEnvironment.createDocComment, "add doc comment");
  const [sendToAgent, setSendToAgent] = useSendToAgentPreference(props.projectId, props.docPath);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-sm shadow-md">
      <CommentInput
        autoFocus
        placeholder="Add a comment"
        submitLabel="Comment"
        alwaysShowActions
        sendToAgent={props.threadId ? sendToAgent : null}
        onSendToAgentChange={setSendToAgent}
        onCancel={() => props.onDone(null)}
        onSubmit={async (body) => {
          const result = await create({
            environmentId: props.environmentId,
            input: {
              projectId: props.projectId,
              docPath: props.docPath,
              ...props.anchor,
              body,
              ...(props.threadId && sendToAgent ? { sendFromThreadId: props.threadId } : {}),
            },
          });
          if (result._tag !== "Success") return false;
          props.onDone(result.value.comment);
          return true;
        }}
      />
    </div>
  );
}

export function DocCommentThreadCard(
  props: CommentTarget & {
    readonly comment: DocComment;
    readonly detached: boolean;
    readonly active: boolean;
    readonly onActivate: () => void;
    readonly onDeactivate: () => void;
    readonly onChanged: () => void;
  },
) {
  const { comment, environmentId } = props;
  const [showAllReplies, setShowAllReplies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendToAgent, setSendToAgent] = useSendToAgentPreference(props.projectId, props.docPath);
  const replyCommand = useAtomCommand(serverEnvironment.replyDocComment, "reply to doc comment");
  const resolveCommand = useAtomCommand(
    serverEnvironment.setDocCommentResolved,
    "resolve doc comment",
  );
  const deleteCommand = useAtomCommand(serverEnvironment.deleteDocComment, "delete doc comment");
  const resolved = comment.resolvedAt !== null;
  const ids = { projectId: comment.projectId, commentId: comment.id };

  const run = async (action: () => Promise<{ readonly _tag: string }>) => {
    if (busy) return false;
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result._tag === "Success") props.onChanged();
    return result._tag === "Success";
  };

  const replies = comment.replies;
  const hiddenReplies =
    props.active || showAllReplies || replies.length <= 1 ? 0 : replies.length - 1;
  const waitingForAgent = isWaitingForAgent(comment);

  return (
    <article
      aria-label={`Comment on “${comment.quote}”`}
      className={cn(
        "group/comment flex flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm transition-shadow",
        props.active ? "border-primary/40 shadow-lg" : "border-border shadow-sm hover:shadow-md",
        resolved && "opacity-75",
      )}
      onClick={props.onActivate}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onDeactivate();
      }}
    >
      {props.detached ? (
        <div className="flex items-center gap-2">
          <Badge variant="warning">Text removed</Badge>
          <span className="line-clamp-1 min-w-0 text-xs text-muted-foreground">
            “{comment.quote}”
          </span>
        </div>
      ) : null}
      <CommentEntry
        author={comment.author}
        createdAt={comment.createdAt}
        body={comment.body}
        actions={
          <div
            className={cn(
              "flex items-center gap-0.5",
              !props.active && "opacity-0 group-hover/comment:opacity-100 focus-within:opacity-100",
            )}
          >
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={resolved ? "Reopen" : "Resolve"}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void run(() =>
                  resolveCommand({ environmentId, input: { ...ids, resolved: !resolved } }),
                );
              }}
            >
              {resolved ? <RotateCcwIcon /> : <CheckIcon />}
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button size="icon-xs" variant="ghost-muted" aria-label="More comment actions" />
                }
                onClick={(event) => event.stopPropagation()}
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  variant="destructive"
                  onClick={() => void run(() => deleteCommand({ environmentId, input: ids }))}
                >
                  <Trash2Icon />
                  Delete thread
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        }
      />
      {comment.sentToThreadId ? (
        <SentToAgentNote
          environmentId={environmentId}
          threadId={latestSentThreadId(comment) ?? comment.sentToThreadId}
          waiting={waitingForAgent}
        />
      ) : null}
      {hiddenReplies > 0 ? (
        <Button
          size="xs"
          variant="ghost-muted"
          className="self-start"
          onClick={(event) => {
            event.stopPropagation();
            setShowAllReplies(true);
          }}
        >
          Show {hiddenReplies} {hiddenReplies === 1 ? "reply" : "replies"}
        </Button>
      ) : null}
      {replies.slice(hiddenReplies).map((reply) => (
        <CommentEntry
          key={reply.id}
          author={reply.author}
          createdAt={reply.createdAt}
          body={reply.body}
        />
      ))}
      {props.active && !resolved ? (
        <CommentInput
          autoFocus={false}
          placeholder="Reply"
          submitLabel="Reply"
          alwaysShowActions={false}
          sendToAgent={props.threadId ? sendToAgent : null}
          onSendToAgentChange={setSendToAgent}
          onCancel={props.onDeactivate}
          onSubmit={(body) =>
            run(() =>
              replyCommand({
                environmentId,
                input: {
                  ...ids,
                  body,
                  ...(props.threadId && sendToAgent ? { sendFromThreadId: props.threadId } : {}),
                },
              }),
            )
          }
        />
      ) : null}
    </article>
  );
}

/** True while the latest message sent to the agent has no agent reply after it. */
export function isWaitingForAgent(comment: DocComment): boolean {
  const messages = [comment, ...comment.replies];
  let waiting = false;
  for (const message of messages) {
    if (message.author.kind === "agent") waiting = false;
    else if (message.sentToThreadId) waiting = true;
  }
  return waiting;
}

function latestSentThreadId(comment: DocComment): ThreadId | null {
  return (
    [comment, ...comment.replies].findLast((message) => message.sentToThreadId)?.sentToThreadId ??
    null
  );
}

function SentToAgentNote(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly waiting: boolean;
}) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <BotIcon className="size-3" />
      {props.waiting ? "Sent to agent · working" : "Sent to agent"}
      <span aria-hidden>·</span>
      {/* Doc comments go to a doc agent sub-thread, which keeps the main chat clean. */}
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams({
          environmentId: props.environmentId,
          threadId: props.threadId,
        })}
        className="underline-offset-2 hover:text-foreground hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        Open agent thread
      </Link>
    </span>
  );
}

function CommentEntry(props: {
  readonly author: DocCommentAuthor;
  readonly createdAt: string;
  readonly body: string;
  readonly actions?: React.ReactNode;
}) {
  const isAgent = props.author.kind === "agent";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
            isAgent ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {isAgent ? <BotIcon className="size-3.5" /> : "Y"}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{isAgent ? "Agent" : "You"}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {formatRelativeTimeLabel(props.createdAt)}
          </span>
        </span>
        {props.actions}
      </div>
      <FoldingText text={props.body} />
    </div>
  );
}

/** Long comments fold behind "Show more", as in Claude Docs. */
function FoldingText({ text }: { readonly text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Runs after every render: whether the text overflows depends on its laid-out height.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && !expanded) setOverflows(element.scrollHeight > element.clientHeight + 1);
  });
  return (
    <div className="pl-8">
      <p ref={ref} className={cn("whitespace-pre-wrap break-words", !expanded && "line-clamp-15")}>
        {text}
      </p>
      {overflows && !expanded ? (
        <Button
          size="xs"
          variant="link"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(true);
          }}
        >
          Show more
        </Button>
      ) : null}
    </div>
  );
}

function CommentInput(props: {
  readonly autoFocus: boolean;
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly alwaysShowActions: boolean;
  /** null hides the box, for comments with no agent to send them to. */
  readonly sendToAgent: boolean | null;
  readonly onSendToAgentChange: (value: boolean) => void;
  readonly onSubmit: (body: string) => Promise<boolean>;
  readonly onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await props.onSubmit(body.trim());
    setBusy(false);
    if (ok) setBody("");
  };
  return (
    <div className="flex flex-col gap-2" onClick={(event) => event.stopPropagation()}>
      <Textarea
        autoFocus={props.autoFocus}
        value={body}
        rows={1}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setBody("");
            props.onCancel();
          }
        }}
      />
      {props.alwaysShowActions || body.trim() ? (
        <div className="flex items-center gap-2">
          {props.sendToAgent !== null ? (
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={props.sendToAgent}
                onCheckedChange={(checked) => props.onSendToAgentChange(checked === true)}
              />
              Send to agent
            </label>
          ) : (
            <span className="flex-1" />
          )}
          <Button size="xs" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="xs" disabled={!body.trim() || busy} onClick={() => void submit()}>
            {props.submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
