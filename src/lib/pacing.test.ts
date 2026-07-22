import { describe, it, expect } from "vitest";
import { estimateSpokenSeconds, captionSchedule, scheduleDuration, cueAt, activeCaptionText } from "./pacing";

describe("estimateSpokenSeconds", () => {
  it("applies the readability floor for short text", () => {
    expect(estimateSpokenSeconds("Ace")).toBe(1.5);
    expect(estimateSpokenSeconds("")).toBe(1.5);
  });
  it("scales with word count above the floor", () => {
    // 10 words / 2.5 wps = 4s
    expect(estimateSpokenSeconds("one two three four five six seven eight nine ten")).toBe(4);
  });
});

describe("captionSchedule", () => {
  const noBuf = { leadSec: 0, tailSec: 0 };
  it("returns null without timers", () => {
    expect(captionSchedule("a\nb")).toBeNull();
    expect(captionSchedule("a\nb", [])).toBeNull();
  });
  it("zips lines with timers into cumulative windows", () => {
    const s = captionSchedule("first\nsecond", [2, 3], noBuf)!;
    expect(s.cues).toEqual([
      { text: "first", sec: 2, start: 0, end: 2 },
      { text: "second", sec: 3, start: 2, end: 5 },
    ]);
    expect(scheduleDuration(s)).toBe(5);
  });
  it("wraps the sequence in a lead-in and tail, offsetting the cues", () => {
    // Default buffers: 1s lead before line 1, 2s tail after line 2.
    const s = captionSchedule("first\nsecond", [2, 3])!;
    expect(s.leadSec).toBe(1);
    expect(s.tailSec).toBe(2);
    expect(s.cues[0]).toMatchObject({ text: "first", start: 1, end: 3 });
    expect(s.cues[1]).toMatchObject({ text: "second", start: 3, end: 6 });
    expect(s.total).toBe(1 + 5 + 2); // lead + lines + tail
  });
  it("drops empty lines but keeps timer alignment by raw row index", () => {
    // Row 1 is blank; its timer (99) is skipped, not shifted onto another line.
    const s = captionSchedule("first\n \nthird", [2, 99, 4], noBuf)!;
    expect(s.cues.map((c) => c.text)).toEqual(["first", "third"]);
    expect(s.cues.map((c) => c.sec)).toEqual([2, 4]);
    expect(scheduleDuration(s)).toBe(6);
  });
  it("falls back to the spoken estimate for a missing/invalid timer", () => {
    const s = captionSchedule("solo line here", [NaN], noBuf)!;
    expect(s.cues[0].sec).toBe(estimateSpokenSeconds("solo line here"));
  });
  it("floors a timer at a small positive minimum", () => {
    expect(captionSchedule("x", [0], noBuf)!.cues[0].sec).toBeCloseTo(0.1);
  });
});

describe("cueAt", () => {
  const s = captionSchedule("first\nsecond", [2, 3], { leadSec: 0, tailSec: 0 });
  it("finds the live cue and returns null in gaps/past the end", () => {
    expect(cueAt(s, 0)?.text).toBe("first");
    expect(cueAt(s, 1.9)?.text).toBe("first");
    expect(cueAt(s, 2)?.text).toBe("second"); // boundary belongs to the next cue
    expect(cueAt(s, 5)).toBeNull(); // at/after the end
    expect(cueAt(null, 1)).toBeNull();
  });
  it("shows no caption during the lead-in and tail buffers", () => {
    const buffered = captionSchedule("first\nsecond", [2, 3])!; // 1s lead, 2s tail
    expect(cueAt(buffered, 0.5)).toBeNull(); // inside the lead-in
    expect(cueAt(buffered, 1)?.text).toBe("first"); // first line starts after the lead
    expect(cueAt(buffered, 6.5)).toBeNull(); // inside the tail (last line ended at 6)
  });
});
describe("activeCaptionText", () => {
  it("sequences multi-line captions as single lines over duration when no timers provided", () => {
    const text = "Blink\nand it's parade time";
    expect(activeCaptionText(text, undefined, 0, 4)).toBe("Blink");
    expect(activeCaptionText(text, undefined, 3, 4)).toBe("and it's parade time");
  });
  it("returns single line text for single line captions", () => {
    expect(activeCaptionText("Hello world", undefined, 0, 4)).toBe("Hello world");
  });
});
