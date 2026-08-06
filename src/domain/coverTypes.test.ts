import { describe, expect, expectTypeOf, it } from "vitest";
import {
  COVER_STICKER_OMITTED_FIELDS,
  COVER_TITLE_OMITTED_FIELDS,
  type Cover,
  type CoverSticker,
  type CoverTitle,
} from "./types";
import type { TitleLayerSettings } from "../state/ExportSettingsContext";

// The Omit lists are the whole point of Task 1: they are what stops a Cover from
// persisting a durationSec on a still image. They are also the thing most likely
// to rot silently, because adding a timing field to TitleLayerSettings does not
// break anything here — it just quietly leaks onto Covers. These tests pin the
// lists at runtime; `satisfies` in types.ts pins each name to a real key.

describe("COVER_TITLE_OMITTED_FIELDS", () => {
  it("drops every field that only means something on a timeline", () => {
    expect([...COVER_TITLE_OMITTED_FIELDS].sort()).toEqual([
      "animDurationSec",
      "animation",
      "durationSec",
      "fadeOut",
      "introSec",
      "scope",
      "startSec",
      "typewriterCursor",
    ]);
  });

  it("keeps every appearance field, since a Cover's title still has to look like something", () => {
    const appearance: (keyof TitleLayerSettings)[] = [
      "id",
      "enabled",
      "text",
      "fontId",
      "fontFile",
      "weight",
      "sizePx",
      "letterSpacing",
      "arcDeg",
      "rotation",
      "shadow",
      "color",
      "posX",
      "posY",
      "boxWidthPct",
      "lineHeight",
      "maskMode",
      "maskColor",
    ];
    const omitted = new Set<string>(COVER_TITLE_OMITTED_FIELDS);
    expect(appearance.filter((k) => omitted.has(k))).toEqual([]);
  });

  it("accounts for every field of TitleLayerSettings, so a new one cannot slip through unclassified", () => {
    // Fails when TitleLayerSettings grows: the author must decide whether the new
    // field is appearance (add it above) or timing (add it to the omit list).
    const appearanceCount = 18;
    const witness: Record<keyof TitleLayerSettings, true> = {
      id: true, enabled: true, text: true, fontId: true, fontFile: true,
      weight: true, sizePx: true, letterSpacing: true, arcDeg: true, rotation: true, shadow: true,
      color: true, posX: true, posY: true, boxWidthPct: true, lineHeight: true,
      maskMode: true, maskColor: true,
      scope: true, introSec: true, startSec: true, durationSec: true,
      fadeOut: true, animation: true, animDurationSec: true, typewriterCursor: true,
    };
    expect(Object.keys(witness)).toHaveLength(appearanceCount + COVER_TITLE_OMITTED_FIELDS.length);
  });
});

describe("COVER_STICKER_OMITTED_FIELDS", () => {
  it("drops the timeline fields and nothing else", () => {
    expect([...COVER_STICKER_OMITTED_FIELDS].sort()).toEqual([
      "durationSec",
      "fitToBeat",
      "startTimeSec",
    ]);
  });
});

describe("the derived types", () => {
  it("reject a timing field and accept an appearance field", () => {
    expectTypeOf<CoverTitle>().not.toHaveProperty("scope");
    expectTypeOf<CoverTitle>().not.toHaveProperty("durationSec");
    expectTypeOf<CoverTitle>().not.toHaveProperty("animation");
    expectTypeOf<CoverTitle>().toHaveProperty("text");
    expectTypeOf<CoverTitle>().toHaveProperty("posX");
    expectTypeOf<CoverTitle>().toHaveProperty("maskColor");

    expectTypeOf<CoverSticker>().not.toHaveProperty("startTimeSec");
    expectTypeOf<CoverSticker>().not.toHaveProperty("fitToBeat");
    expectTypeOf<CoverSticker>().toHaveProperty("fileName");
    expectTypeOf<CoverSticker>().toHaveProperty("rotation");
  });

  it("carries the fields a Cover needs and no origin discriminator", () => {
    expectTypeOf<Cover>().toHaveProperty("frame");
    expectTypeOf<Cover>().toHaveProperty("sourceLabel");
    expectTypeOf<Cover>().toHaveProperty("veil");
    // Origin is not modelled — an uploaded Cover and a captured one are one type.
    expectTypeOf<Cover>().not.toHaveProperty("kind");
    expectTypeOf<Cover>().not.toHaveProperty("sourceBeatId");
  });
});
