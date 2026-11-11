import { memo, useEffect } from "react";
import { Square, Volume2 } from "lucide";
import { Button } from "../ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { cn } from "~/lib/utils";
import {
  readAloudSupported,
  stopReadAloud,
  toggleReadAloud,
  useIsReadingAloud,
} from "~/lib/readAloud";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const MessageReadAloudButton = memo(function MessageReadAloudButton({
  messageId,
  text,
}: {
  messageId: string;
  text: string;
}) {
  const isReading = useIsReadingAloud(messageId);
  if (!readAloudSupported) return null;
  const label = isReading ? "Stop reading" : "Read aloud";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={isReading}
            onClick={() => toggleReadAloud(messageId, text)}
            type="button"
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        <MorphIcon
          className={cn("size-3", isReading && "text-primary")}
          icon={isReading ? Square : Volume2}
        />
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});

/** Keyed by thread: speech outlives the row that started it, so leaving the thread ends it. */
export function ReadAloudThreadScope() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancels the browser's speech queue, which lives outside React, when the thread is left.
  useEffect(() => stopReadAloud, []);
  return null;
}
