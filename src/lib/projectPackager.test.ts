import { afterEach, describe, it, expect, vi } from "vitest";
import { importProjectFile } from "./projectPackager";
import type { Clip } from "../domain/types";

// The .vidstr round-trip for Stills (ADR-0012). Export strips `file` and
// `normalized` and serializes the rest, so `kind` rides along for free — what
// needs guarding is the IMPORT side, which used to set `normalized` on every
// clip and would hand ffmpeg an image under an .mp4 name.

const dataUrl = (mime: string) => `data:${mime};base64,${btoa("pretend-bytes")}`;

afterEach(() => vi.unstubAllGlobals());

/** A serialized clip as it appears inside stateJson (no file/normalized). */
type SerializedClip = Omit<Clip, "file" | "normalized">;

function vidstr(clips: SerializedClip[]): File {
  const media = clips.map((c) => ({
    clipId: c.id,
    fileName: c.name,
    fileType: c.name.endsWith(".jpg") ? "image/jpeg" : "video/mp4",
    fileDataUrl: dataUrl(c.name.endsWith(".jpg") ? "image/jpeg" : "video/mp4"),
    poster: undefined,
  }));
  const pkg = {
    version: 1,
    exportedAt: 0,
    title: "round trip",
    stateJson: JSON.stringify({ title: "round trip", clips, direction: "" }),
    media,
  };
  return new File([JSON.stringify(pkg)], "p.vidstr", { type: "application/json" });
}

const still: SerializedClip = { id: "s1", name: "beach.jpg", durationSec: 10, width: 4000, height: 3000, kind: "still" };
const video: SerializedClip = { id: "v1", name: "surf.mp4", durationSec: 7.5, width: 1920, height: 1080 };

describe("importProjectFile — Stills", () => {
  it("preserves kind and the synthetic duration", async () => {
    const state = await importProjectFile(vidstr([still, video]));
    expect(state.clips[0]).toMatchObject({ id: "s1", kind: "still", durationSec: 10, width: 4000, height: 3000 });
    expect(state.clips[1].kind).toBeUndefined();
    expect(state.clips[1].durationSec).toBe(7.5);
  });

  it("leaves a Still's `normalized` unset so sourceName keeps its extension", async () => {
    const state = await importProjectFile(vidstr([still, video]));
    expect(state.clips[0].normalized).toBeUndefined();
    // Footage is unchanged — it still gets the normalized blob it always did.
    expect(state.clips[1].normalized).toBeInstanceOf(Blob);
  });

  it("rehydrates the Still's file under its own name and type", async () => {
    const state = await importProjectFile(vidstr([still]));
    expect(state.clips[0].file.name).toBe("beach.jpg");
    expect(state.clips[0].file.type).toBe("image/jpeg");
  });

  it("loads a project saved before `kind` existed as footage", async () => {
    const legacy: SerializedClip = { id: "old", name: "clip.mp4", durationSec: 3, width: 1280, height: 720 };
    const state = await importProjectFile(vidstr([legacy]));
    expect(state.clips[0].kind).toBeUndefined();
    expect(state.clips[0].normalized).toBeInstanceOf(Blob);
  });
});

describe("importProjectFile — music track", () => {
  it("rehydrates a reference-only track from the app Music library", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
    })));
    const metadata = {
      id: "music-shared",
      name: "shared.wav",
      fileName: "shared.wav",
      durationSec: 3,
      waveform: [0.2],
      cueMarkers: [],
      volume: 0.5,
      sourceKind: "audio",
    };
    const pkg = {
      version: 1,
      exportedAt: 0,
      title: "shared music",
      stateJson: JSON.stringify({ title: "shared music", clips: [], direction: "", musicTrack: metadata }),
      media: [],
    };

    const state = await importProjectFile(new File([JSON.stringify(pkg)], "shared.vidstr", { type: "application/json" }));

    expect(state.musicTrack).toMatchObject(metadata);
    expect(state.musicTrack?.file).toMatchObject({ name: "shared.wav", type: "audio/wav", size: 3 });
  });

  it("rehydrates the audio-only file alongside waveform and cue analysis", async () => {
    const metadata = {
      id: "music-1",
      name: "performance.wav",
      durationSec: 8,
      waveform: [0.1, 0.7, 0.2],
      cueMarkers: [{ timeSec: 2.5, strength: 0.9 }],
      volume: 0.6,
      sourceKind: "video-audio",
    };
    const pkg = {
      version: 1,
      exportedAt: 0,
      title: "music",
      stateJson: JSON.stringify({ title: "music", clips: [], direction: "", musicTrack: metadata }),
      media: [],
      musicTrack: {
        fileName: "performance.wav",
        fileType: "audio/wav",
        fileDataUrl: dataUrl("audio/wav"),
      },
    };

    const state = await importProjectFile(new File([JSON.stringify(pkg)], "music.vidstr", { type: "application/json" }));
    expect(state.musicTrack).toMatchObject(metadata);
    expect(state.musicTrack?.file).toBeInstanceOf(File);
    expect(state.musicTrack?.file.name).toBe("performance.wav");
    expect(state.musicTrack?.file.type).toBe("audio/wav");
  });
});

// --- Ken Burns persistence (ADR-0015) --------------------------------------
// framing/kenBurns live on Beat, inside cut, inside stateJson — so they should
// ride along for free. "Should" is why this test exists: stripTitleFonts and
// reinjectTitleFonts both rebuild every Beat on the way through.

function vidstrWithCut(beats: unknown[]): File {
  const pkg = {
    version: 1,
    exportedAt: 0,
    title: "kb",
    stateJson: JSON.stringify({
      title: "kb",
      direction: "",
      clips: [still],
      cut: { aspect: "16:9", beats },
    }),
    media: [{
      clipId: still.id, fileName: still.name, fileType: "image/jpeg",
      fileDataUrl: dataUrl("image/jpeg"), poster: undefined,
    }],
  };
  return new File([JSON.stringify(pkg)], "p.vidstr", { type: "application/json" });
}

const kbBeat = {
  id: "b1", clipId: "s1", inSec: 0, outSec: 10, durationSec: 10,
  scriptText: "", captionText: "",
  framing: "kenBurns",
  kenBurns: { fromScale: 1, fromX: -8, fromY: -5, toScale: 1.2, toX: 8, toY: 5 },
};

describe("importProjectFile — Ken Burns", () => {
  it("round-trips the framing mode and all six values", async () => {
    const state = await importProjectFile(vidstrWithCut([kbBeat]));
    const b = state.cut!.beats[0];
    expect(b.framing).toBe("kenBurns");
    expect(b.kenBurns).toEqual({ fromScale: 1, fromX: -8, fromY: -5, toScale: 1.2, toX: 8, toY: 5 });
  });

  it("survives a Beat that also carries title layers", async () => {
    // The title-font strip/reinject rebuilds every Beat; a spread that dropped
    // unknown fields would lose the move and only show up on reload.
    const withTitles = {
      ...kbBeat,
      titleLayers: [{ id: "l1", enabled: true, text: "Hi", fontId: "outfit", fontFile: null, weight: 700, sizePx: 120, color: "#fff", posX: 0, posY: 0, scope: "entire", introSec: 3 }],
    };
    const state = await importProjectFile(vidstrWithCut([withTitles]));
    const b = state.cut!.beats[0];
    expect(b.framing).toBe("kenBurns");
    expect(b.kenBurns?.toScale).toBe(1.2);
    expect(b.titleLayers?.[0].text).toBe("Hi");
  });

  it("leaves a Beat with no move untouched — undefined means Zoom", async () => {
    const plain = { id: "b2", clipId: "s1", inSec: 0, outSec: 5, durationSec: 5, scriptText: "", captionText: "", zoom: 1.4 };
    const state = await importProjectFile(vidstrWithCut([plain]));
    const b = state.cut!.beats[0];
    expect(b.framing).toBeUndefined();
    expect(b.kenBurns).toBeUndefined();
    expect(b.zoom).toBe(1.4);
  });
});

describe("importProjectFile — Product Review workspace", () => {
  it("round-trips the verified brief, Creator Notes, and generated plan", async () => {
    const productReview = {
      brief: {
        source: { kind: "amazon", url: "https://www.amazon.com/dp/B0ABC12345", asin: "B0ABC12345" },
        title: "Trail Press",
        features: [{ id: "claim-1", text: "Steel body", source: "listing" }],
      },
      creatorNotes: {
        audience: "travel vloggers",
        problem: "hotel coffee",
        experience: "used on a train",
        pros: ["compact"],
        cons: [],
        verdict: "pack it",
        disclosure: "purchased",
      },
      plan: {
        id: "plan-1",
        productTitle: "Trail Press",
        targetDurationSec: 30,
        hook: "Skip hotel coffee.",
        script: [],
        shots: [],
        createdAt: 1,
      },
    };
    const pkg = {
      version: 1,
      exportedAt: 0,
      title: "review",
      stateJson: JSON.stringify({ title: "review", clips: [], direction: "", productReview }),
      media: [],
    };
    const state = await importProjectFile(new File([JSON.stringify(pkg)], "review.vidstr", { type: "application/json" }));
    expect(state.productReview).toEqual(productReview);
  });
});
