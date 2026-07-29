import type { Beat } from "../domain/types";
import type { TitleLayerSettings } from "../state/ExportSettingsContext";

export interface BeatTitleIndexEntry {
  beat: Beat;
  beatIndex: number;
  layers: TitleLayerSettings[];
}

export function activeBeatTitleCount(beat: Beat): number {
  return (beat.titleLayers ?? []).filter(
    (layer) => layer.enabled && layer.text.trim(),
  ).length;
}

/** Only Beats with at least one title that is currently visible belong here. */
export function collectBeatTitleEntries(beats: Beat[]): BeatTitleIndexEntry[] {
  return beats.flatMap((beat, beatIndex) => {
    const layers = (beat.titleLayers ?? []).filter(
      (layer) => layer.enabled && layer.text.trim(),
    );
    return layers.length ? [{ beat, beatIndex, layers }] : [];
  });
}

/** Apply an index edit while preserving the Title editor's empty-text invariant. */
export function updateBeatTitleText(
  beat: Beat,
  layerId: string,
  text: string,
): Beat {
  return {
    ...beat,
    titleLayers: (beat.titleLayers ?? []).map((layer) =>
      layer.id === layerId
        ? { ...layer, text, enabled: text.trim().length > 0 }
        : layer
    ),
  };
}
