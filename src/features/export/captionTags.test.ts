import { describe, expect, it } from "vitest";
import type { VoSegment } from "../../domain/types";
import { activeVoCaption, activeVoSegment } from "../../lib/pacing";
import { exportedCaptionWindows } from "./captionWindows";

// The narration text is one string doing two jobs: it is sent to ElevenLabs with its
// audio tags intact, and it is shown as a caption with them removed. These pin the split
// at both caption chokepoints — the previews go through activeVoCaption, the export
// through exportedCaptionWindows.

function vo(overrides: Partial<VoSegment> = {}): VoSegment {
  return {
    id: "v1",
    text: "[excited] We ship today. [laughs]",
    startTimeSec: 0,
    durationSec: 4,
    captionVisible: true,
    ...overrides,
  };
}

describe("captions drop audio tags, synthesis keeps them", () => {
  it("strips tags from the preview caption", () => {
    expect(activeVoCaption([vo()], 1)).toBe("We ship today.");
  });

  it("strips tags from the burned-in export caption", () => {
    const [window] = exportedCaptionWindows([vo()], 0, 4);
    expect(window.text).toBe("We ship today.");
  });

  it("leaves the segment's own text untouched, so TTS still receives the tags", () => {
    const segments = [vo()];
    activeVoCaption(segments, 1);
    exportedCaptionWindows(segments, 0, 4);

    // Every synthesis path reads the segment through activeVoSegment or segment.text.
    expect(activeVoSegment(segments, 1)?.text).toBe("[excited] We ship today. [laughs]");
    expect(segments[0].text).toBe("[excited] We ship today. [laughs]");
  });

  it("shows no caption when the narration is nothing but tags", () => {
    const segments = [vo({ text: "[laughs] [sighs]" })];
    expect(activeVoCaption(segments, 1)).toBe("");
    expect(exportedCaptionWindows(segments, 0, 4)).toEqual([]);
  });

  it("still keeps the audio for a tags-only segment, which is not silent", () => {
    // activeVoSegment gates on raw text, so the delivery-only segment still plays.
    const segments = [vo({ text: "[laughs]" })];
    expect(activeVoSegment(segments, 1)?.id).toBe("v1");
  });

  it("honours the caption toggle independently of tags", () => {
    const segments = [vo({ captionVisible: false })];
    expect(activeVoCaption(segments, 1)).toBe("");
    expect(exportedCaptionWindows(segments, 0, 4)).toEqual([]);
  });

  it("leaves an untagged narration exactly as written", () => {
    const segments = [vo({ text: "Week nine, and the brace still clicks." })];
    expect(activeVoCaption(segments, 1)).toBe("Week nine, and the brace still clicks.");
    expect(exportedCaptionWindows(segments, 0, 4)[0].text).toBe("Week nine, and the brace still clicks.");
  });
});
