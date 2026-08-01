import type { Clip, ClipDescription, Cut, Beat, Story, OverlayClip, VoSegment, SfxSegment, UserVoiceSegment, Sticker, ColorAdjustments } from "../domain/types";
import type { CreatorNotes, ProductBrief, ProductReviewWorkspace, ReviewPlan } from "../domain/productReview";
import type { MotivationalStoryWorkspace } from "../domain/motivationalStory";
import { emptyCreatorNotes } from "../domain/productReview";

/** The whole editing session. One store; every phase reads/writes it. */
export interface ProjectState {
  /** Author-given project name (empty = "Untitled project"); names the export. */
  title: string;
  clips: Clip[];
  /** Optional author-supplied steer for the Story (ADR-0001). */
  direction: string;
  story?: Story;
  cut?: Cut;
  /** Product-review planning workspace; optional for pre-Phase-2 projects. */
  productReview?: ProductReviewWorkspace;
  /** Motivational story workspace. */
  motivationalStory?: MotivationalStoryWorkspace;
}

export const initialState: ProjectState = { title: "", clips: [], direction: "" };

export type Action =
  | { type: "SET_TITLE"; title: string }
  | { type: "ADD_CLIPS"; clips: Clip[] }
  | { type: "REMOVE_CLIP"; id: string }
  | { type: "DELETE_CLIP_FROM_PROJECT"; id: string; placeholderIds?: string[] }
  | { type: "RENAME_CLIP"; id: string; name: string }
  | { type: "SET_NORMALIZED"; id: string; normalized: Blob }
  | { type: "SET_POSTER"; id: string; poster: string }
  | { type: "SET_DESCRIPTION"; id: string; description: ClipDescription }
  | { type: "SET_INCLUDED"; id: string; included: boolean }
  | { type: "SET_CLIP_TAGS"; id: string; tags: string[] }
  | { type: "SET_DIRECTION"; direction: string }
  | { type: "SET_PRODUCT_BRIEF"; brief: ProductBrief; importWarnings?: string[] }
  | { type: "SET_CREATOR_NOTES"; creatorNotes: CreatorNotes }
  | { type: "SET_REVIEW_PLAN"; plan: ReviewPlan }
  | { type: "LOAD_PRODUCT_REVIEW"; workspace: ProductReviewWorkspace }
  | { type: "CLEAR_PRODUCT_REVIEW" }
  | { type: "SET_MOTIVATIONAL_STORY"; workspace: MotivationalStoryWorkspace }
  | { type: "LOAD_MOTIVATIONAL_STORY"; workspace: MotivationalStoryWorkspace }
  | { type: "CLEAR_MOTIVATIONAL_STORY" }
  | { type: "SET_STORY"; story: Story }
  | { type: "SET_CUT"; cut: Cut }
  | { type: "APPLY_TEMPLATE"; cut: Cut; placeholderClips?: Clip[] }
  | { type: "UPDATE_BEAT"; beat: Beat }
  | { type: "FILL_TEMPLATE_SLOT"; beatId: string; clipId: string; newClipId?: string }
  | { type: "ADD_BEAT"; beat: Beat }
  | { type: "REMOVE_BEAT"; id: string }
  | { type: "REMOVE_BEAT_AND_CLIP"; id: string }
  | { type: "DUPLICATE_BEAT"; id: string; newBeatId?: string; newClipId?: string }
  | { type: "REORDER_BEATS"; order: string[] }
  | { type: "ADD_OVERLAY"; overlay: OverlayClip }
  | { type: "UPDATE_OVERLAY"; overlay: OverlayClip }
  | { type: "REMOVE_OVERLAY"; id: string }
  | { type: "DUPLICATE_OVERLAY"; id: string; newOverlayId?: string }
  | { type: "ADD_VO"; segment: VoSegment }
  | { type: "UPDATE_VO"; segment: VoSegment }
  /** Replace several VO segments at once — one dispatch per group drag frame. */
  | { type: "UPDATE_VOS"; segments: VoSegment[] }
  | { type: "REMOVE_VO"; id: string }
  /** Remove several VO segments at once, so deleting a multi-selection is one step. */
  | { type: "REMOVE_VOS"; ids: string[] }
  | { type: "DUPLICATE_VO"; id: string; newVoId?: string }
  | { type: "ADD_SFX"; segment: SfxSegment }
  | { type: "UPDATE_SFX"; segment: SfxSegment }
  | { type: "REMOVE_SFX"; id: string }
  | { type: "DUPLICATE_SFX"; id: string; newSfxId?: string }
  | { type: "ADD_USER_VOICE"; segment: UserVoiceSegment }
  | { type: "UPDATE_USER_VOICE"; segment: UserVoiceSegment }
  | { type: "REMOVE_USER_VOICE"; id: string }
  | { type: "DUPLICATE_USER_VOICE"; id: string; newUserVoiceId?: string }
  | { type: "ADD_STICKER"; sticker: Sticker }
  | { type: "UPDATE_STICKER"; sticker: Sticker }
  | { type: "REMOVE_STICKER"; id: string }
  | { type: "DUPLICATE_STICKER"; id: string; newStickerId?: string }
  | { type: "SET_GLOBAL_FILTER"; filterId: string | null; intensity?: number; adjustments?: ColorAdjustments }
  | { type: "LOAD_PROJECT"; state: ProjectState }
  | { type: "RESET" };

function patchClip(clips: Clip[], id: string, patch: Partial<Clip>): Clip[] {
  return clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

export function projectReducer(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case "LOAD_PROJECT":
      return { ...action.state };
    case "SET_TITLE":
      return { ...state, title: action.title };
    case "ADD_CLIPS":
      return { ...state, clips: [...state.clips, ...action.clips] };
    case "REMOVE_CLIP":
      return { ...state, clips: state.clips.filter((c) => c.id !== action.id) };
    case "DELETE_CLIP_FROM_PROJECT": {
      const removedClip = state.clips.find((clip) => clip.id === action.id);
      if (!removedClip) return state;
      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const placeholderClips: Clip[] = [];
      let placeholderIndex = 0;
      const beats = state.cut?.beats.map((beat) => {
        if (beat.clipId !== removedClip.id) return beat;
        const description = beat.templateSlotDescription ?? removedClip.templateSlotDescription ?? `Replacement for ${removedClip.name}`;
        const placeholder: Clip = {
          id: action.placeholderIds?.[placeholderIndex++] ?? `template-slot-${genId()}`,
          file: new File([], `empty-slot-${beat.id}.mp4`, { type: "video/mp4" }),
          name: `Empty · ${description}`,
          durationSec: beat.durationSec,
          width: removedClip.width,
          height: removedClip.height,
          isTemplatePlaceholder: true,
          templateSlotDescription: description,
        };
        placeholderClips.push(placeholder);
        return {
          ...beat,
          clipId: placeholder.id,
          inSec: 0,
          outSec: beat.durationSec,
          templateSlotDescription: description,
        };
      });
      const repairedBeats = beats?.map((beat) => {
        if (!beat.splitScreen?.slots.some((slot) => slot.clipId === removedClip.id)) return beat;
        const slots = beat.splitScreen.slots.filter((slot) => slot.clipId !== removedClip.id);
        return { ...beat, splitScreen: slots.length >= 2 ? { ...beat.splitScreen, slots } : undefined };
      });
      return {
        ...state,
        clips: [...state.clips.filter((clip) => clip.id !== removedClip.id), ...placeholderClips],
        story: state.story
          ? { ...state.story, beats: state.story.beats.filter((beat) => beat.clipId !== removedClip.id) }
          : undefined,
        cut: state.cut
          ? {
              ...state.cut,
              beats: repairedBeats ?? state.cut.beats,
              overlays: (state.cut.overlays ?? []).filter((overlay) => overlay.clipId !== removedClip.id),
            }
          : undefined,
      };
    }
    case "RENAME_CLIP":
      return { ...state, clips: patchClip(state.clips, action.id, { name: action.name }) };
    case "SET_NORMALIZED":
      return { ...state, clips: patchClip(state.clips, action.id, { normalized: action.normalized }) };
    case "SET_POSTER":
      return { ...state, clips: patchClip(state.clips, action.id, { poster: action.poster }) };
    case "SET_DESCRIPTION":
      return { ...state, clips: patchClip(state.clips, action.id, { description: action.description }) };
    case "SET_INCLUDED":
      return { ...state, clips: patchClip(state.clips, action.id, { included: action.included }) };
    case "SET_CLIP_TAGS":
      return { ...state, clips: patchClip(state.clips, action.id, { tags: action.tags }) };
    case "SET_DIRECTION":
      return { ...state, direction: action.direction };
    case "SET_PRODUCT_BRIEF":
      return {
        ...state,
        productReview: {
          creatorNotes: state.productReview?.creatorNotes ?? emptyCreatorNotes(),
          ...state.productReview,
          brief: action.brief,
          importWarnings: action.importWarnings,
        },
      };
    case "SET_CREATOR_NOTES":
      return {
        ...state,
        productReview: {
          ...state.productReview,
          creatorNotes: action.creatorNotes,
        },
      };
    case "SET_REVIEW_PLAN":
      return {
        ...state,
        productReview: {
          creatorNotes: state.productReview?.creatorNotes ?? emptyCreatorNotes(),
          ...state.productReview,
          plan: action.plan,
        },
      };
    case "LOAD_PRODUCT_REVIEW":
      return { ...state, productReview: action.workspace };
    case "CLEAR_PRODUCT_REVIEW":
      return { ...state, productReview: undefined };
    case "SET_MOTIVATIONAL_STORY":
      return { ...state, motivationalStory: action.workspace };
    case "LOAD_MOTIVATIONAL_STORY":
      return { ...state, motivationalStory: action.workspace };
    case "CLEAR_MOTIVATIONAL_STORY":
      return { ...state, motivationalStory: undefined };
    case "SET_STORY":
      return { ...state, story: action.story };
    case "SET_CUT":
      return { ...state, cut: action.cut };
    case "APPLY_TEMPLATE":
      return {
        ...state,
        story: undefined,
        cut: action.cut,
        clips: [
          ...state.clips.filter((clip) => !clip.isTemplatePlaceholder),
          ...(action.placeholderClips ?? []),
        ],
      };
    case "UPDATE_BEAT": {
      if (!state.cut) return state;
      const beats = state.cut.beats.map((b) => (b.id === action.beat.id ? action.beat : b));
      return { ...state, cut: { ...state.cut, beats } };
    }
    case "FILL_TEMPLATE_SLOT": {
      if (!state.cut) return state;
      const targetBeat = state.cut.beats.find((beat) => beat.id === action.beatId);
      const replacement = state.clips.find((clip) => clip.id === action.clipId && !clip.isTemplatePlaceholder);
      if (!targetBeat || !replacement) return state;

      const placeholder = state.clips.find((clip) => clip.id === targetBeat.clipId);
      if (!placeholder?.isTemplatePlaceholder) return state;

      const alreadyUsed = state.cut.beats.some((beat) => beat.id !== targetBeat.id && beat.clipId === replacement.id);
      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const assignedClip: Clip = alreadyUsed
        ? {
            ...replacement,
            id: action.newClipId ?? genId(),
            description: replacement.description ? { ...replacement.description } : undefined,
          }
        : replacement;
      const targetDuration = Math.min(targetBeat.durationSec, replacement.durationSec || targetBeat.durationSec);
      const inSec = Math.max(0, Math.min(targetBeat.inSec, replacement.durationSec - targetDuration));
      const filledBeat = {
        ...targetBeat,
        clipId: assignedClip.id,
        inSec,
        outSec: inSec + targetDuration,
        durationSec: targetDuration,
      };
      return {
        ...state,
        clips: state.clips.flatMap((clip) => {
          if (clip.id !== placeholder.id) return [clip];
          return alreadyUsed ? [assignedClip] : [];
        }),
        cut: {
          ...state.cut,
          beats: state.cut.beats.map((beat) => beat.id === targetBeat.id ? filledBeat : beat),
        },
      };
    }
    case "ADD_BEAT": {
      if (!state.cut) return state;
      return { ...state, cut: { ...state.cut, beats: [...state.cut.beats, action.beat] } };
    }
    case "REMOVE_BEAT": {
      if (!state.cut) return state;
      return { ...state, cut: { ...state.cut, beats: state.cut.beats.filter((b) => b.id !== action.id) } };
    }
    case "REMOVE_BEAT_AND_CLIP": {
      if (!state.cut) return state;
      const removedBeat = state.cut.beats.find((beat) => beat.id === action.id);
      if (!removedBeat) return state;

      const clipId = removedBeat.clipId;
      const remainingBeats = state.cut.beats.filter((beat) => beat.id !== action.id);
      const stillReferenced =
        remainingBeats.some((beat) => beat.clipId === clipId || beat.splitScreen?.slots.some((slot) => slot.clipId === clipId)) ||
        (state.cut.overlays ?? []).some((overlay) => overlay.clipId === clipId);

      return {
        ...state,
        clips: stillReferenced ? state.clips : state.clips.filter((clip) => clip.id !== clipId),
        story: state.story && !stillReferenced
          ? { ...state.story, beats: state.story.beats.filter((beat) => beat.clipId !== clipId) }
          : state.story,
        cut: { ...state.cut, beats: remainingBeats },
      };
    }
    case "ADD_OVERLAY": {
      if (!state.cut) return state;
      const overlays = [...(state.cut.overlays ?? []), action.overlay];
      return { ...state, cut: { ...state.cut, overlays } };
    }
    case "UPDATE_OVERLAY": {
      if (!state.cut) return state;
      const overlays = (state.cut.overlays ?? []).map((o) => (o.id === action.overlay.id ? action.overlay : o));
      return { ...state, cut: { ...state.cut, overlays } };
    }
    case "REMOVE_OVERLAY": {
      if (!state.cut) return state;
      const overlays = (state.cut.overlays ?? []).filter((o) => o.id !== action.id);
      return { ...state, cut: { ...state.cut, overlays } };
    }
    case "DUPLICATE_OVERLAY": {
      if (!state.cut) return state;
      const target = (state.cut.overlays ?? []).find((o) => o.id === action.id);
      if (!target) return state;

      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const newId = action.newOverlayId ?? `overlay-${genId()}`;
      const totalDur = state.cut.beats.reduce((acc, b) => acc + (b.durationSec || Math.max(0.05, b.outSec - b.inSec)), 0);
      const newStart = Math.min(Math.max(0, totalDur - target.durationSec), target.startTimeSec + 0.5);

      const duplicated: OverlayClip = {
        ...target,
        id: newId,
        startTimeSec: Math.round(newStart * 10) / 10,
      };

      const overlays = [...(state.cut.overlays ?? []), duplicated];
      return { ...state, cut: { ...state.cut, overlays } };
    }
    case "ADD_VO": {
      if (!state.cut) return state;
      const voSegments = [...(state.cut.voSegments ?? []), action.segment];
      return { ...state, cut: { ...state.cut, voSegments } };
    }
    case "UPDATE_VO": {
      if (!state.cut) return state;
      const voSegments = (state.cut.voSegments ?? []).map((s) => (s.id === action.segment.id ? action.segment : s));
      return { ...state, cut: { ...state.cut, voSegments } };
    }
    case "UPDATE_VOS": {
      if (!state.cut || action.segments.length === 0) return state;
      const byId = new Map(action.segments.map((segment) => [segment.id, segment]));
      const voSegments = (state.cut.voSegments ?? []).map((s) => byId.get(s.id) ?? s);
      return { ...state, cut: { ...state.cut, voSegments } };
    }
    case "REMOVE_VO": {
      if (!state.cut) return state;
      const voSegments = (state.cut.voSegments ?? []).filter((s) => s.id !== action.id);
      return { ...state, cut: { ...state.cut, voSegments } };
    }
    case "REMOVE_VOS": {
      if (!state.cut || action.ids.length === 0) return state;
      const drop = new Set(action.ids);
      const current = state.cut.voSegments ?? [];
      const voSegments = current.filter((s) => !drop.has(s.id));
      if (voSegments.length === current.length) return state;
      return { ...state, cut: { ...state.cut, voSegments } };
    }
    case "DUPLICATE_VO": {
      if (!state.cut) return state;
      const target = (state.cut.voSegments ?? []).find((s) => s.id === action.id);
      if (!target) return state;
      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const newId = action.newVoId ?? `vo-${genId()}`;
      const totalDur = state.cut.beats.reduce((acc, b) => acc + (b.durationSec || Math.max(0.05, b.outSec - b.inSec)), 0);
      const newStart = Math.min(Math.max(0, totalDur - target.durationSec), target.startTimeSec + 0.5);
      const duplicated: VoSegment = { ...target, id: newId, startTimeSec: Math.round(newStart * 10) / 10 };
      const voSegments = [...(state.cut.voSegments ?? []), duplicated];
      return { ...state, cut: { ...state.cut, voSegments } };
    }
    case "ADD_SFX": {
      if (!state.cut) return state;
      const sfxSegments = [...(state.cut.sfxSegments ?? []), action.segment];
      return { ...state, cut: { ...state.cut, sfxSegments } };
    }
    case "UPDATE_SFX": {
      if (!state.cut) return state;
      const sfxSegments = (state.cut.sfxSegments ?? []).map((s) => (s.id === action.segment.id ? action.segment : s));
      return { ...state, cut: { ...state.cut, sfxSegments } };
    }
    case "REMOVE_SFX": {
      if (!state.cut) return state;
      const sfxSegments = (state.cut.sfxSegments ?? []).filter((s) => s.id !== action.id);
      return { ...state, cut: { ...state.cut, sfxSegments } };
    }
    case "DUPLICATE_SFX": {
      if (!state.cut) return state;
      const target = (state.cut.sfxSegments ?? []).find((s) => s.id === action.id);
      if (!target) return state;
      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const newId = action.newSfxId ?? `sfx-${genId()}`;
      const totalDur = state.cut.beats.reduce((acc, b) => acc + (b.durationSec || Math.max(0.05, b.outSec - b.inSec)), 0);
      const newStart = Math.min(Math.max(0, totalDur - target.durationSec), target.startTimeSec + 0.5);
      const duplicated: SfxSegment = { ...target, id: newId, startTimeSec: Math.round(newStart * 10) / 10 };
      const sfxSegments = [...(state.cut.sfxSegments ?? []), duplicated];
      return { ...state, cut: { ...state.cut, sfxSegments } };
    }
    case "ADD_USER_VOICE": {
      if (!state.cut) return state;
      return {
        ...state,
        cut: {
          ...state.cut,
          userVoiceSegments: [...(state.cut.userVoiceSegments ?? []), action.segment],
        },
      };
    }
    case "UPDATE_USER_VOICE": {
      if (!state.cut) return state;
      return {
        ...state,
        cut: {
          ...state.cut,
          userVoiceSegments: (state.cut.userVoiceSegments ?? []).map((segment) =>
            segment.id === action.segment.id ? action.segment : segment
          ),
        },
      };
    }
    case "REMOVE_USER_VOICE": {
      if (!state.cut) return state;
      return {
        ...state,
        cut: {
          ...state.cut,
          userVoiceSegments: (state.cut.userVoiceSegments ?? []).filter((segment) => segment.id !== action.id),
        },
      };
    }
    case "DUPLICATE_USER_VOICE": {
      if (!state.cut) return state;
      const target = (state.cut.userVoiceSegments ?? []).find((segment) => segment.id === action.id);
      if (!target) return state;
      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const totalDur = state.cut.beats.reduce((sum, beat) => sum + (beat.durationSec || Math.max(0.05, beat.outSec - beat.inSec)), 0);
      const newStart = Math.min(Math.max(0, totalDur - target.durationSec), target.startTimeSec + 0.5);
      const duplicated: UserVoiceSegment = {
        ...target,
        id: action.newUserVoiceId ?? `user-vo-${genId()}`,
        name: `${target.name} copy`,
        startTimeSec: Math.round(newStart * 10) / 10,
      };
      return {
        ...state,
        cut: {
          ...state.cut,
          userVoiceSegments: [...(state.cut.userVoiceSegments ?? []), duplicated],
        },
      };
    }
    // The four Sticker cases mirror the SFX ones above, including the +0.5s
    // nudge on duplicate so the copy is visibly offset rather than hidden.
    case "ADD_STICKER": {
      if (!state.cut) return state;
      const stickers = [...(state.cut.stickers ?? []), action.sticker];
      return { ...state, cut: { ...state.cut, stickers } };
    }
    case "UPDATE_STICKER": {
      if (!state.cut) return state;
      const stickers = (state.cut.stickers ?? []).map((s) => (s.id === action.sticker.id ? action.sticker : s));
      return { ...state, cut: { ...state.cut, stickers } };
    }
    case "REMOVE_STICKER": {
      if (!state.cut) return state;
      const stickers = (state.cut.stickers ?? []).filter((s) => s.id !== action.id);
      return { ...state, cut: { ...state.cut, stickers } };
    }
    case "DUPLICATE_STICKER": {
      if (!state.cut) return state;
      const target = (state.cut.stickers ?? []).find((s) => s.id === action.id);
      if (!target) return state;
      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const newId = action.newStickerId ?? `sticker-${genId()}`;
      const durs = state.cut.beats.map((b) => b.durationSec || Math.max(0.05, b.outSec - b.inSec));
      const totalDur = durs.reduce((acc, d) => acc + d, 0);
      let newStart: number;
      if (target.fitToBeat) {
        // A beat-pinned copy goes to the NEXT beat. Offsetting by 0.5s would
        // usually leave it in the same beat, where it renders exactly on top of
        // the original — identical position and width — and looks like nothing
        // happened.
        let acc = 0;
        let nextStart = target.startTimeSec;
        for (const d of durs) {
          if (target.startTimeSec < acc + d) { nextStart = acc + d; break; }
          acc += d;
        }
        // No next beat: fall back to nudging within the last one.
        newStart = nextStart < totalDur ? nextStart : Math.max(0, target.startTimeSec + 0.5);
      } else {
        newStart = Math.min(Math.max(0, totalDur - target.durationSec), target.startTimeSec + 0.5);
      }
      const duplicated: Sticker = { ...target, id: newId, startTimeSec: Math.round(newStart * 10) / 10 };
      const stickers = [...(state.cut.stickers ?? []), duplicated];
      return { ...state, cut: { ...state.cut, stickers } };
    }
    case "SET_GLOBAL_FILTER": {
      if (!state.cut) return state;
      return {
        ...state,
        cut: {
          ...state.cut,
          globalFilterId: action.filterId ?? undefined,
          globalFilterIntensity: action.intensity ?? state.cut.globalFilterIntensity ?? 1,
          globalFilterAdjustments: action.filterId === null ? undefined : (action.adjustments !== undefined ? action.adjustments : state.cut.globalFilterAdjustments),
        },
      };
    }
    case "DUPLICATE_BEAT": {
      if (!state.cut) return state;
      const idx = state.cut.beats.findIndex((b) => b.id === action.id);
      if (idx < 0) return state;
      const originalBeat = state.cut.beats[idx];
      const originalClip = state.clips.find((c) => c.id === originalBeat.clipId);

      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const newClipId = action.newClipId ?? genId();
      const newBeatId = action.newBeatId ?? genId();

      let updatedClips = state.clips;
      let targetClipId = originalBeat.clipId;

      if (originalClip) {
        const dupClip: Clip = {
          ...originalClip,
          id: newClipId,
          description: originalClip.description ? { ...originalClip.description } : undefined,
        };
        const clipIdx = state.clips.findIndex((c) => c.id === originalClip.id);
        updatedClips = [...state.clips];
        updatedClips.splice(clipIdx >= 0 ? clipIdx + 1 : updatedClips.length, 0, dupClip);
        targetClipId = newClipId;
      }

      const dupBeat: Beat = {
        ...originalBeat,
        id: newBeatId,
        clipId: targetClipId,
        captionText: "",
        captionDurations: undefined,
      };

      const beats = [...state.cut.beats];
      beats.splice(idx + 1, 0, dupBeat);

      return {
        ...state,
        clips: updatedClips,
        cut: { ...state.cut, beats },
      };
    }
    case "REORDER_BEATS": {
      if (!state.cut) return state;
      const byId = new Map(state.cut.beats.map((b) => [b.id, b]));
      const beats = action.order.map((id) => byId.get(id)).filter((b): b is Beat => !!b);
      return { ...state, cut: { ...state.cut, beats } };
    }
    case "RESET":
      return initialState;
    default:
      return state;
  }
}
