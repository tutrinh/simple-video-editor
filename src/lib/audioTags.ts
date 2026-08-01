// ElevenLabs v3 audio tags — [whispers], [excited], [laughs], [strong French accent] —
// are delivery instructions that have to sit inline in the text sent for synthesis.
// They are not part of what the narrator says, so they must never reach a caption.
//
// The raw segment text stays the source of truth and is what goes to TTS; captions run
// through stripAudioTags on the way to the screen and to the burned-in export.

/**
 * A bracketed run with no nested brackets or line breaks, short enough to be a tag.
 * The length cap is what keeps a genuine bracketed aside in a narration line — a long
 * parenthetical, a quoted passage — from being swallowed as if it were an instruction.
 */
const AUDIO_TAG = /\[[^[\]\n]{1,50}\]/g;

/** True when the text carries at least one thing that reads as an audio tag. */
export function hasAudioTags(text: string): boolean {
  AUDIO_TAG.lastIndex = 0;
  return AUDIO_TAG.test(text);
}

/**
 * The text as it should appear on screen: tags removed, and the gaps they leave tidied
 * so a mid-sentence tag doesn't leave a double space or a space before punctuation.
 * Returns the input unchanged when there is nothing to strip.
 */
export function stripAudioTags(text: string): string {
  if (!text.includes("[")) return text;

  const stripped = text
    .replace(AUDIO_TAG, " ")
    // A tag between words leaves two spaces; one at either end leaves a stray edge.
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]+([,.;:!?…])/g, "$1")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n[^\S\n]+/g, "\n")
    .trim();

  return stripped;
}
