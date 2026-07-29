import { describe, expect, it } from "vitest";
import type { Beat } from "../domain/types";
import { makeBeatTitleLayers } from "../state/ExportSettingsContext";
import { activeBeatTitleCount, collectBeatTitleEntries, updateBeatTitleText } from "./beatTitleIndex";

function beat(id: string, title?: string): Beat {
  const layers = makeBeatTitleLayers();
  if (title !== undefined) {
    layers[0] = { ...layers[0], enabled: true, text: title };
  }
  return {
    id,
    clipId: `clip-${id}`,
    inSec: 0,
    outSec: 3,
    durationSec: 3,
    scriptText: "",
    captionText: "",
    titleLayers: layers,
  };
}

describe("Beat title index", () => {
  it("counts only active, non-empty title layers", () => {
    const titledBeat = beat("a", "OPEN");
    titledBeat.titleLayers![1] = {
      ...titledBeat.titleLayers![1],
      enabled: true,
      text: "SUBTITLE",
    };
    titledBeat.titleLayers![2] = {
      ...titledBeat.titleLayers![2],
      enabled: false,
      text: "HIDDEN",
    };

    expect(activeBeatTitleCount(titledBeat)).toBe(2);
    expect(activeBeatTitleCount(beat("b"))).toBe(0);
  });

  it("lists only Beats with visible title layers", () => {
    const entries = collectBeatTitleEntries([
      beat("a", "OPEN"),
      beat("b"),
      beat("c", "FINISH"),
    ]);

    expect(entries.map((entry) => [entry.beat.id, entry.beatIndex, entry.layers[0].text]))
      .toEqual([
        ["a", 0, "OPEN"],
        ["c", 2, "FINISH"],
      ]);
  });

  it("updates the requested layer without changing the other Beat settings", () => {
    const original = beat("a", "OPEN");
    const updated = updateBeatTitleText(original, "beat-layer-1", "NEW OPEN");

    expect(updated.titleLayers?.[0]).toMatchObject({
      id: "beat-layer-1",
      enabled: true,
      text: "NEW OPEN",
    });
    expect(updated.durationSec).toBe(original.durationSec);
  });

  it("disables a title layer when its text is cleared", () => {
    const updated = updateBeatTitleText(beat("a", "OPEN"), "beat-layer-1", "");
    expect(updated.titleLayers?.[0]).toMatchObject({ enabled: false, text: "" });
  });
});
