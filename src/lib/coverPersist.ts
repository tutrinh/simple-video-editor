import type { ProjectState } from "../state/projectReducer";
import type { Cover, CoverTitle } from "../domain/types";

// Covers carry their pixels (ADR-0021), so they persist the way every other
// binary in a Project does: out-of-band in IndexedDB or base64'd into the
// .vidstr, stripped from the JSON on the way out and reinjected on the way back.
// Mirrors userVoicePersist.ts deliberately — same shape, same call sites.

export interface CoverFileEntry {
  key: string;
  file: File;
}

type SerializedCover = Omit<Cover, "frame">;

export function collectCoverFiles(state: ProjectState): CoverFileEntry[] {
  return (state.covers ?? [])
    .filter((cover) => cover.frame instanceof Blob)
    .map((cover) => ({ key: cover.id, file: cover.frame }));
}

export function coverKeys(state: ProjectState): string[] {
  return (state.covers ?? []).map((cover) => cover.id);
}

/**
 * A Cover's Title without its uploaded font File.
 *
 * `fontFile` is legacy — modern uploads live in the app font library and a Title
 * refers to them by `fontId` alone — but the field survives on the derived type,
 * and a `File` that reaches `JSON.stringify` serialises to `{}`. That is worse
 * than losing it: `{}` is truthy, so the reloaded Title would carry a font file
 * that is not one, and `getTitleFontBytes` would be handed an empty object.
 */
function stripTitleFontFile(title: CoverTitle): CoverTitle {
  return title.fontFile ? { ...title, fontFile: null } : title;
}

export function stripCoverFiles(state: ProjectState): ProjectState {
  if (!state.covers) return state;
  const covers = state.covers.map(({ frame: _frame, ...cover }) => ({
    ...cover,
    titles: cover.titles.map(stripTitleFontFile),
  }));
  return { ...state, covers: covers as Cover[] };
}

/**
 * Put the pixels back. A Cover whose frame did not come back is dropped rather
 * than kept as an entry with no picture — it has nothing left to render, and
 * every consumer would need a broken state to describe it.
 */
export function reinjectCoverFiles(state: ProjectState, files: Map<string, Blob>): ProjectState {
  if (!state.covers) return state;
  const covers = (state.covers as unknown as SerializedCover[]).flatMap((cover) => {
    const blob = files.get(cover.id);
    if (!blob) return [];
    const frame = blob instanceof File
      ? blob
      : new File([blob], `${cover.id}.jpg`, { type: blob.type || "image/jpeg" });
    return [{ ...cover, frame }];
  });
  return { ...state, covers };
}
