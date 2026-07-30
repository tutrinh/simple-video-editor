import { describe, it, expect } from "vitest";
import { projectReducer, initialState } from "./projectReducer";
import type { Clip, Beat, Cut } from "../domain/types";

const clip = (id: string): Clip => ({
  id, file: new File([], `${id}.mp4`), name: `${id}.mp4`, durationSec: 10, width: 1920, height: 1080,
});
const beat = (id: string, clipId: string): Beat => ({
  id, clipId, inSec: 0, outSec: 3, durationSec: 3, scriptText: "", captionText: "",
});

describe("projectReducer", () => {
  it("adds and removes clips", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a"), clip("b")] });
    expect(s.clips.map((c) => c.id)).toEqual(["a", "b"]);
    s = projectReducer(s, { type: "REMOVE_CLIP", id: "a" });
    expect(s.clips.map((c) => c.id)).toEqual(["b"]);
  });

  it("deleting a referenced clip keeps its beat as an assignable placeholder", () => {
    const source = clip("a");
    const referencedBeat = {
      ...beat("1", "a"),
      durationSec: 4,
      outSec: 4,
      templateSlotDescription: "Close-up product detail",
      zoom: 1.2,
      transition: "fade" as const,
    };
    const state = {
      ...initialState,
      clips: [source, clip("b")],
      cut: { beats: [referencedBeat, beat("2", "b")], aspect: "16:9" as const },
    };
    const next = projectReducer(state, {
      type: "DELETE_CLIP_FROM_PROJECT",
      id: "a",
      placeholderIds: ["empty-a"],
    });

    expect(next.clips.map((item) => item.id)).toEqual(["b", "empty-a"]);
    expect(next.clips[1]).toMatchObject({
      isTemplatePlaceholder: true,
      templateSlotDescription: "Close-up product detail",
    });
    expect(next.cut?.beats[0]).toMatchObject({
      id: "1",
      clipId: "empty-a",
      durationSec: 4,
      templateSlotDescription: "Close-up product detail",
      zoom: 1.2,
      transition: "fade",
    });
    expect(next.cut?.beats.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("deleting clip media removes its overlay and split-screen references", () => {
    const splitBeat: Beat = {
      ...beat("1", "b"),
      splitScreen: {
        layout: "3-col",
        slots: [
          { clipId: "a", inSec: 0, volume: 0 },
          { clipId: "b", inSec: 0, volume: 0 },
          { clipId: "c", inSec: 0, volume: 0 },
        ],
      },
    };
    const state = {
      ...initialState,
      clips: [clip("a"), clip("b"), clip("c")],
      cut: {
        beats: [splitBeat],
        overlays: [{ id: "ov", clipId: "a", startTimeSec: 0, durationSec: 1, inSec: 0, outSec: 1, blendMode: "normal" as const, opacity: 1, volume: 0 }],
        aspect: "16:9" as const,
      },
    };
    const next = projectReducer(state, { type: "DELETE_CLIP_FROM_PROJECT", id: "a" });
    expect(next.cut?.overlays).toEqual([]);
    expect(next.cut?.beats[0].splitScreen?.slots.map((slot) => slot.clipId)).toEqual(["b", "c"]);
  });

  it("patches a clip's description without touching others", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a"), clip("b")] });
    s = projectReducer(s, {
      type: "SET_DESCRIPTION",
      id: "b",
      description: { subjectAction: "x", settingMood: "y", usability: 4, model: "m", raw: "r" },
    });
    expect(s.clips.find((c) => c.id === "a")?.description).toBeUndefined();
    expect(s.clips.find((c) => c.id === "b")?.description?.usability).toBe(4);
  });

  it("toggles a clip's included flag", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a"), clip("b")] });
    expect(s.clips.find((c) => c.id === "a")?.included).toBeUndefined(); // undefined = included
    s = projectReducer(s, { type: "SET_INCLUDED", id: "a", included: false });
    expect(s.clips.find((c) => c.id === "a")?.included).toBe(false);
    expect(s.clips.find((c) => c.id === "b")?.included).toBeUndefined();
  });

  it("reorders beats by id, dropping unknown ids", () => {
    const cut: Cut = { beats: [beat("1", "a"), beat("2", "b"), beat("3", "c")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [] }, { type: "SET_CUT", cut });
    s = projectReducer(s, { type: "REORDER_BEATS", order: ["3", "1", "zzz", "2"] });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["3", "1", "2"]);
  });

  it("applies a template cut atomically and clears a stale authored story", () => {
    const previous = {
      ...initialState,
      clips: [clip("a"), clip("b")],
      story: { logline: "Old story", beats: [{ clipId: "a", scriptText: "Old line" }] },
      cut: { beats: [beat("old", "a")], aspect: "16:9" as const },
    };
    const nextCut: Cut = { beats: [beat("new", "b")], aspect: "9:16" };
    const placeholder = { ...clip("slot"), isTemplatePlaceholder: true };
    const next = projectReducer(previous, { type: "APPLY_TEMPLATE", cut: nextCut, placeholderClips: [placeholder] });

    expect(next.story).toBeUndefined();
    expect(next.cut).toBe(nextCut);
    expect(next.clips).toEqual([...previous.clips, placeholder]);
  });

  it("adds, duplicates (as separate clip and beat instances), and removes beats on the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    s = projectReducer(s, { type: "ADD_BEAT", beat: beat("2", "b") });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["1", "2"]);
    s = projectReducer(s, { type: "DUPLICATE_BEAT", id: "1", newBeatId: "1-dup", newClipId: "a-dup" });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["1", "1-dup", "2"]);
    expect(s.cut?.beats[1].clipId).toBe("a-dup");
    expect(s.clips.map((c) => c.id)).toContain("a-dup");
    s = projectReducer(s, { type: "REMOVE_BEAT", id: "1" });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["1-dup", "2"]);
  });

  it("can remove a beat and its unreferenced source clip together", () => {
    const state = {
      ...initialState,
      clips: [clip("a"), clip("b")],
      story: { logline: "Story", beats: [{ clipId: "a", scriptText: "A" }, { clipId: "b", scriptText: "B" }] },
      cut: { beats: [beat("1", "a"), beat("2", "b")], aspect: "16:9" as const },
    };
    const next = projectReducer(state, { type: "REMOVE_BEAT_AND_CLIP", id: "1" });
    expect(next.cut?.beats.map((item) => item.id)).toEqual(["2"]);
    expect(next.clips.map((item) => item.id)).toEqual(["b"]);
    expect(next.story?.beats.map((item) => item.clipId)).toEqual(["b"]);
  });

  it("keeps the source clip when another cut element still references it", () => {
    const state = {
      ...initialState,
      clips: [clip("a")],
      cut: {
        beats: [beat("1", "a")],
        overlays: [{ id: "ov", clipId: "a", startTimeSec: 0, durationSec: 1, inSec: 0, outSec: 1, blendMode: "normal" as const, opacity: 1, volume: 0 }],
        aspect: "16:9" as const,
      },
    };
    const next = projectReducer(state, { type: "REMOVE_BEAT_AND_CLIP", id: "1" });
    expect(next.cut?.beats).toHaveLength(0);
    expect(next.clips.map((item) => item.id)).toEqual(["a"]);
  });

  it("fills a template placeholder atomically while preserving beat guidance", () => {
    const placeholder = { ...clip("slot"), isTemplatePlaceholder: true, templateSlotDescription: "Detail shot" };
    const slotBeat = { ...beat("slot-beat", "slot"), durationSec: 3, outSec: 3, templateSlotDescription: "Detail shot" };
    const state = {
      ...initialState,
      clips: [{ ...clip("real"), durationSec: 2 }, placeholder],
      cut: { beats: [slotBeat], aspect: "16:9" as const },
    };
    const next = projectReducer(state, { type: "FILL_TEMPLATE_SLOT", beatId: "slot-beat", clipId: "real" });
    expect(next.clips.map((item) => item.id)).toEqual(["real"]);
    expect(next.cut?.beats[0]).toMatchObject({
      clipId: "real",
      durationSec: 2,
      inSec: 0,
      outSec: 2,
      templateSlotDescription: "Detail shot",
    });
  });

  it("duplicates an already-used reference clip when filling another template slot", () => {
    const real = clip("real");
    const placeholder = { ...clip("slot"), isTemplatePlaceholder: true };
    const state = {
      ...initialState,
      clips: [real, placeholder],
      cut: {
        beats: [beat("existing", "real"), { ...beat("slot-beat", "slot"), templateSlotDescription: "Second angle" }],
        aspect: "16:9" as const,
      },
    };
    const next = projectReducer(state, {
      type: "FILL_TEMPLATE_SLOT",
      beatId: "slot-beat",
      clipId: "real",
      newClipId: "real-instance-2",
    });

    expect(next.clips.map((item) => item.id)).toEqual(["real", "real-instance-2"]);
    expect(next.cut?.beats.map((item) => item.clipId)).toEqual(["real", "real-instance-2"]);
    expect(next.clips[1].file).toBe(real.file);
    expect(next.cut?.beats[1].templateSlotDescription).toBe("Second angle");
  });

  it("adds, updates, and removes overlays on the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const ov = {
      id: "ov1",
      clipId: "a",
      startTimeSec: 1,
      durationSec: 3,
      inSec: 0,
      outSec: 3,
      blendMode: "normal" as const,
      opacity: 0.8,
      volume: 0.5,
    };
    s = projectReducer(s, { type: "ADD_OVERLAY", overlay: ov });
    expect(s.cut?.overlays).toHaveLength(1);
    expect(s.cut?.overlays?.[0].blendMode).toBe("normal");

    s = projectReducer(s, { type: "UPDATE_OVERLAY", overlay: { ...ov, blendMode: "screen", opacity: 0.9 } });
    expect(s.cut?.overlays?.[0].blendMode).toBe("screen");
    expect(s.cut?.overlays?.[0].opacity).toBe(0.9);

    s = projectReducer(s, { type: "DUPLICATE_OVERLAY", id: "ov1", newOverlayId: "ov1-dup" });
    expect(s.cut?.overlays).toHaveLength(2);
    expect(s.cut?.overlays?.[1].id).toBe("ov1-dup");
    expect(s.cut?.overlays?.[1].blendMode).toBe("screen");

    s = projectReducer(s, { type: "REMOVE_OVERLAY", id: "ov1" });
    expect(s.cut?.overlays).toHaveLength(1);
  });

  it("adds, updates, duplicates, and removes VO segments on the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const seg = { id: "vo1", text: "hello", startTimeSec: 1, durationSec: 2, captionVisible: true };

    s = projectReducer(s, { type: "ADD_VO", segment: seg });
    expect(s.cut?.voSegments).toHaveLength(1);
    expect(s.cut?.voSegments?.[0].text).toBe("hello");

    s = projectReducer(s, { type: "UPDATE_VO", segment: { ...seg, text: "world", captionVisible: false } });
    expect(s.cut?.voSegments?.[0].text).toBe("world");
    expect(s.cut?.voSegments?.[0].captionVisible).toBe(false);

    s = projectReducer(s, { type: "DUPLICATE_VO", id: "vo1", newVoId: "vo1-dup" });
    expect(s.cut?.voSegments).toHaveLength(2);
    expect(s.cut?.voSegments?.[1].id).toBe("vo1-dup");
    expect(s.cut?.voSegments?.[1].text).toBe("world");

    s = projectReducer(s, { type: "REMOVE_VO", id: "vo1" });
    expect(s.cut?.voSegments?.map((v) => v.id)).toEqual(["vo1-dup"]);
  });

  it("adds, updates, duplicates, and removes Stickers on the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const sticker = {
      id: "st1", fileName: "star.png", startTimeSec: 1, durationSec: 2,
      x: 0.5, y: 0.5, scale: 0.25, rotation: 0, opacity: 1,
    };

    s = projectReducer(s, { type: "ADD_STICKER", sticker });
    expect(s.cut?.stickers).toHaveLength(1);
    expect(s.cut?.stickers?.[0].fileName).toBe("star.png");

    s = projectReducer(s, { type: "UPDATE_STICKER", sticker: { ...sticker, scale: 0.4, rotation: -30 } });
    expect(s.cut?.stickers?.[0].scale).toBe(0.4);
    expect(s.cut?.stickers?.[0].rotation).toBe(-30);

    s = projectReducer(s, { type: "DUPLICATE_STICKER", id: "st1", newStickerId: "st1-dup" });
    expect(s.cut?.stickers).toHaveLength(2);
    expect(s.cut?.stickers?.[1].id).toBe("st1-dup");
    expect(s.cut?.stickers?.[1].fileName).toBe("star.png");
    // Carries the spatial fields across, so a duplicate looks identical.
    expect(s.cut?.stickers?.[1].scale).toBe(0.4);

    s = projectReducer(s, { type: "REMOVE_STICKER", id: "st1" });
    expect(s.cut?.stickers).toHaveLength(1);
    expect(s.cut?.stickers?.[0].id).toBe("st1-dup");
  });

  it("offsets a duplicated Sticker by 0.5s, clamped inside the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const total = s.cut!.beats.reduce((a, b) => a + b.durationSec, 0);

    s = projectReducer(s, { type: "ADD_STICKER", sticker: {
      id: "st1", fileName: "a.png", startTimeSec: 0, durationSec: 1,
      x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1,
    } });
    s = projectReducer(s, { type: "DUPLICATE_STICKER", id: "st1", newStickerId: "d1" });
    expect(s.cut?.stickers?.[1].startTimeSec).toBe(0.5);

    // A sticker at the very end cannot be pushed past it.
    s = projectReducer(s, { type: "ADD_STICKER", sticker: {
      id: "st2", fileName: "b.png", startTimeSec: total - 1, durationSec: 1,
      x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1,
    } });
    s = projectReducer(s, { type: "DUPLICATE_STICKER", id: "st2", newStickerId: "d2" });
    const dup = s.cut?.stickers?.find((x) => x.id === "d2");
    expect(dup!.startTimeSec + dup!.durationSec).toBeLessThanOrEqual(total + 1e-9);
  });

  it("duplicates a beat-pinned Sticker into the NEXT beat", () => {
    // The reported bug: a fitToBeat duplicate offset by 0.5s stayed in the same
    // beat, rendered exactly on top of the original, and looked immovable.
    const cut: Cut = { beats: [beat("1", "a"), beat("2", "a"), beat("3", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const d0 = s.cut!.beats[0].durationSec;

    s = projectReducer(s, { type: "ADD_STICKER", sticker: {
      id: "st1", fileName: "a.png", startTimeSec: 0.2, durationSec: 1,
      x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1, fitToBeat: true,
    } });
    s = projectReducer(s, { type: "DUPLICATE_STICKER", id: "st1", newStickerId: "d1" });

    const dup = s.cut?.stickers?.find((x) => x.id === "d1");
    expect(dup!.startTimeSec).toBeCloseTo(d0, 5);   // start of beat 2
    expect(dup!.fitToBeat).toBe(true);              // still pinned
    expect(dup!.startTimeSec).not.toBe(0.2);        // not stacked on the original
  });

  it("keeps a pinned duplicate inside the cut when there is no next beat", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const total = s.cut!.beats.reduce((a, b) => a + b.durationSec, 0);

    s = projectReducer(s, { type: "ADD_STICKER", sticker: {
      id: "st1", fileName: "a.png", startTimeSec: 0.2, durationSec: 1,
      x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1, fitToBeat: true,
    } });
    s = projectReducer(s, { type: "DUPLICATE_STICKER", id: "st1", newStickerId: "d1" });
    const dup = s.cut?.stickers?.find((x) => x.id === "d1");
    expect(dup!.startTimeSec).toBeLessThan(total);
  });

  it("still offsets a FREE Sticker duplicate by 0.5s", () => {
    const cut: Cut = { beats: [beat("1", "a"), beat("2", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    s = projectReducer(s, { type: "ADD_STICKER", sticker: {
      id: "st1", fileName: "a.png", startTimeSec: 1, durationSec: 1,
      x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1,
    } });
    s = projectReducer(s, { type: "DUPLICATE_STICKER", id: "st1", newStickerId: "d1" });
    expect(s.cut?.stickers?.find((x) => x.id === "d1")!.startTimeSec).toBe(1.5);
  });

  it("leaves Sticker actions inert when there is no cut", () => {
    const sticker = {
      id: "st1", fileName: "a.png", startTimeSec: 0, durationSec: 1,
      x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1,
    };
    expect(projectReducer(initialState, { type: "ADD_STICKER", sticker }).cut).toBeUndefined();
    expect(projectReducer(initialState, { type: "REMOVE_STICKER", id: "st1" }).cut).toBeUndefined();
    expect(projectReducer(initialState, { type: "DUPLICATE_STICKER", id: "st1" }).cut).toBeUndefined();
  });

  it("adds, updates, duplicates, and removes SFX segments on the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const seg = { id: "sfx1", fileName: "whoosh.mp3", startTimeSec: 1, durationSec: 0.8, sourceDurationSec: 0.8, volume: 1 };

    s = projectReducer(s, { type: "ADD_SFX", segment: seg });
    expect(s.cut?.sfxSegments).toHaveLength(1);
    expect(s.cut?.sfxSegments?.[0].fileName).toBe("whoosh.mp3");

    s = projectReducer(s, { type: "UPDATE_SFX", segment: { ...seg, volume: 0.5, durationSec: 0.5 } });
    expect(s.cut?.sfxSegments?.[0].volume).toBe(0.5);
    expect(s.cut?.sfxSegments?.[0].durationSec).toBe(0.5);

    s = projectReducer(s, { type: "DUPLICATE_SFX", id: "sfx1", newSfxId: "sfx1-dup" });
    expect(s.cut?.sfxSegments).toHaveLength(2);
    expect(s.cut?.sfxSegments?.[1].id).toBe("sfx1-dup");
    expect(s.cut?.sfxSegments?.[1].fileName).toBe("whoosh.mp3");

    s = projectReducer(s, { type: "REMOVE_SFX", id: "sfx1" });
    expect(s.cut?.sfxSegments?.map((x) => x.id)).toEqual(["sfx1-dup"]);
  });

  it("adds, updates, duplicates, and removes User VO recordings", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const file = new File([new Uint8Array([1])], "take.webm", { type: "audio/webm" });
    const segment = {
      id: "uvo1",
      name: "Beat 1 voice",
      file,
      startTimeSec: 0,
      durationSec: 0.8,
      sourceDurationSec: 0.8,
      sourceStartSec: 0,
      volume: 1,
      levelDb: 0,
      bassDb: 0,
      trebleDb: 0,
    };

    s = projectReducer(s, { type: "ADD_USER_VOICE", segment });
    expect(s.cut?.userVoiceSegments?.[0].file).toBe(file);

    s = projectReducer(s, { type: "UPDATE_USER_VOICE", segment: { ...segment, volume: 0.5, levelDb: 3, bassDb: 4, trebleDb: -2 } });
    expect(s.cut?.userVoiceSegments?.[0].volume).toBe(0.5);

    s = projectReducer(s, { type: "DUPLICATE_USER_VOICE", id: "uvo1", newUserVoiceId: "uvo2" });
    expect(s.cut?.userVoiceSegments?.map((item) => item.id)).toEqual(["uvo1", "uvo2"]);
    expect(s.cut?.userVoiceSegments?.[1].file).toBe(file);
    expect(s.cut?.userVoiceSegments?.[1]).toMatchObject({ volume: 0.5, levelDb: 3, bassDb: 4, trebleDb: -2 });

    s = projectReducer(s, { type: "REMOVE_USER_VOICE", id: "uvo1" });
    expect(s.cut?.userVoiceSegments?.map((item) => item.id)).toEqual(["uvo2"]);
  });

  it("sets and resets global look and feel filter on cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    expect(s.cut?.globalFilterId).toBeUndefined();

    s = projectReducer(s, { type: "SET_GLOBAL_FILTER", filterId: "teal-orange", intensity: 0.8 });
    expect(s.cut?.globalFilterId).toBe("teal-orange");
    expect(s.cut?.globalFilterIntensity).toBe(0.8);

    s = projectReducer(s, { type: "SET_GLOBAL_FILTER", filterId: null });
    expect(s.cut?.globalFilterId).toBeUndefined();
  });

  it("resets to initial", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a")] });
    s = projectReducer(s, { type: "SET_DIRECTION", direction: "funnier" });
    s = projectReducer(s, { type: "RESET" });
    expect(s).toEqual(initialState);
  });

  it("stores a coherent Product Brief, Creator Notes, and Review Plan workspace", () => {
    const brief = {
      source: { kind: "amazon" as const, url: "https://www.amazon.com/dp/B012345678", asin: "B012345678" },
      title: "Travel Coffee Press",
      features: [{ id: "claim-1", text: "Insulated steel body", source: "listing" as const }],
    };
    const creatorNotes = {
      audience: "commuters",
      problem: "bad hotel coffee",
      experience: "kept coffee hot through a long train ride",
      pros: ["compact"],
      cons: ["hand wash only"],
      verdict: "worth packing",
      disclosure: "purchased" as const,
    };
    const plan = {
      id: "plan-1",
      productTitle: brief.title,
      targetDurationSec: 30 as const,
      hook: "Hotel coffee is optional now.",
      script: [],
      shots: [],
      createdAt: 1,
    };

    let state = projectReducer(initialState, { type: "SET_PRODUCT_BRIEF", brief });
    state = projectReducer(state, { type: "SET_CREATOR_NOTES", creatorNotes });
    state = projectReducer(state, { type: "SET_REVIEW_PLAN", plan });

    expect(state.productReview).toEqual({ brief, creatorNotes, plan });
    expect(projectReducer(state, { type: "CLEAR_PRODUCT_REVIEW" }).productReview).toBeUndefined();
  });
});
