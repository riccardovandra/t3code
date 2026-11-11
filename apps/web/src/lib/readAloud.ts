import { useSyncExternalStore } from "react";

/** Reduces a markdown message to the words a person would say out loud. */
export function speakableText(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?(```|$)/g, "\nCode block skipped.\n")
      .replace(/^\|.*\|[ \t]*$/gm, (row) =>
        /^[|\s:-]+$/.test(row)
          ? ""
          : `${row
              .split("|")
              .map((cell) => cell.trim())
              .filter(Boolean)
              .join(", ")}.`,
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^#{1,6}\s*(.*)$/gm, "$1.")
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      // Markers inside a word are part of it (snake_case), not emphasis.
      .replace(/(?<![\p{L}\p{N}])(\*\*|__|\*|_)(\S(?:.*?\S)?)\1(?![\p{L}\p{N}])/gu, "$2")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

export function splitSentences(text: string): ReadonlyArray<string> {
  return (text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
}

export const readAloudSupported =
  typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

// Where Chrome offers its own voice it sounds far better than the system default.
const PREFERRED_VOICE_NAME = "Google US English";

let playingId: string | null = null;
const listeners = new Set<() => void>();

function setPlayingId(next: string | null) {
  if (playingId === next) return;
  playingId = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function stopReadAloud() {
  if (!readAloudSupported) return;
  setPlayingId(null);
  window.speechSynthesis.cancel();
}

/** Starts reading `markdown`, or stops if `id` is already the one playing. */
export function toggleReadAloud(id: string, markdown: string) {
  if (!readAloudSupported) return;
  const wasPlaying = playingId === id;
  stopReadAloud();
  if (wasPlaying) return;

  const sentences = splitSentences(speakableText(markdown));
  if (sentences.length === 0) return;
  const voice = window.speechSynthesis
    .getVoices()
    .find((candidate) => candidate.name === PREFERRED_VOICE_NAME);
  setPlayingId(id);
  // One utterance per sentence: Chrome silently cuts off long utterances.
  sentences.forEach((sentence, index) => {
    const utterance = new SpeechSynthesisUtterance(sentence);
    if (voice) utterance.voice = voice;
    const finish = () => {
      if (playingId === id) setPlayingId(null);
    };
    if (index === sentences.length - 1) utterance.addEventListener("end", finish);
    utterance.addEventListener("error", finish);
    window.speechSynthesis.speak(utterance);
  });
}

export function useIsReadingAloud(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => playingId === id,
    () => false,
  );
}
