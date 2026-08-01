import { describe, expect, it } from "vitest";
import { hasAudioTags, stripAudioTags } from "./audioTags";

describe("stripAudioTags", () => {
  it("removes a leading tag", () => {
    expect(stripAudioTags("[excited] We ship today.")).toBe("We ship today.");
  });

  it("removes a trailing tag", () => {
    expect(stripAudioTags("We ship today. [laughs]")).toBe("We ship today.");
  });

  it("closes the gap a mid-sentence tag leaves", () => {
    expect(stripAudioTags("I read it [sighs] every morning.")).toBe("I read it every morning.");
  });

  it("does not leave a space before punctuation", () => {
    expect(stripAudioTags("Week nine [sighs], and the brace still clicks."))
      .toBe("Week nine, and the brace still clicks.");
    expect(stripAudioTags("Really [whispers]…")).toBe("Really…");
  });

  it("removes several tags in one line", () => {
    expect(stripAudioTags("[whispers] Three weeks in [pause] and I nearly quit. [sighs]"))
      .toBe("Three weeks in and I nearly quit.");
  });

  it("handles multi-word tags", () => {
    expect(stripAudioTags("[strong French accent] Bonjour.")).toBe("Bonjour.");
  });

  it("returns an empty string when the text is only tags", () => {
    expect(stripAudioTags("[laughs]")).toBe("");
    expect(stripAudioTags("[laughs] [sighs]")).toBe("");
  });

  it("preserves line breaks between caption lines", () => {
    expect(stripAudioTags("[excited] First line\n[whispers] Second line"))
      .toBe("First line\nSecond line");
  });

  it("leaves text without brackets untouched, and identical", () => {
    const text = "The surgery date is on a strip of tape inside my locker.";
    expect(stripAudioTags(text)).toBe(text);
  });

  it("keeps a long bracketed aside, which is prose rather than a tag", () => {
    const text = "He said [and this is the part nobody believes, not even his own coach] he would be back.";
    expect(stripAudioTags(text)).toBe(text);
  });

  it("keeps unbalanced brackets rather than eating the rest of the line", () => {
    expect(stripAudioTags("A [ B C")).toBe("A [ B C");
    expect(stripAudioTags("A ] B C")).toBe("A ] B C");
  });

  it("does not span a line break when a bracket is left open", () => {
    expect(stripAudioTags("Start [oops\nsecond line]")).toBe("Start [oops\nsecond line]");
  });
});

describe("hasAudioTags", () => {
  it("detects a tag anywhere in the line", () => {
    expect(hasAudioTags("[excited] Go")).toBe(true);
    expect(hasAudioTags("Go [laughs]")).toBe(true);
  });

  it("is false for plain text and for long bracketed prose", () => {
    expect(hasAudioTags("Just a normal narration line.")).toBe(false);
    expect(hasAudioTags("He said [and this is the part nobody believes, not even his coach] so.")).toBe(false);
  });

  it("is repeatable — the shared regex does not carry lastIndex between calls", () => {
    const text = "[excited] Go";
    expect(hasAudioTags(text)).toBe(true);
    expect(hasAudioTags(text)).toBe(true);
    expect(hasAudioTags(text)).toBe(true);
  });
});
