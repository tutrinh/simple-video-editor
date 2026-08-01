// Which timeline action a keydown maps to, separated from StudioApp so the guards
// (modifiers, key repeat, typing into a form control) are testable on their own.

export type TimelineKeyAction =
  /** Move the selection to the previous/next beat. */
  | { kind: "select"; direction: 1 | -1 }
  /** Grow/shrink the selected beat's duration by one Inspector step. */
  | { kind: "resize"; direction: 1 | -1 }
  /** Fit the selected voiceover segment's length to its spoken duration. */
  | { kind: "fit-vo" };

export interface TimelineKeyEvent {
  key: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** True when the keystroke is being typed into an input/textarea/select/contenteditable. */
  fromFormControl: boolean;
}

export function resolveTimelineKeyAction(event: TimelineKeyEvent): TimelineKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.fromFormControl) return null;

  switch (event.key) {
    case "ArrowUp":
    case "ArrowDown":
      // Holding the key to keep nudging a duration is wanted, so repeats pass through.
      return { kind: "resize", direction: event.key === "ArrowUp" ? 1 : -1 };
    case "ArrowLeft":
    case "ArrowRight":
      // Holding an arrow to spin through the beat selection is not.
      if (event.repeat) return null;
      return { kind: "select", direction: event.key === "ArrowRight" ? 1 : -1 };
    default:
      // `f` fits the selected voiceover. Each press starts a synthesis request, so a
      // held key must not queue a burst of them.
      if (!event.repeat && event.key.toLowerCase() === "f") return { kind: "fit-vo" };
      return null;
  }
}

/** True when a keystroke originated inside a control that owns its own key handling. */
export function isFromFormControl(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.isContentEditable
    || element?.closest?.("input, textarea, select, [contenteditable='true']")
  );
}
