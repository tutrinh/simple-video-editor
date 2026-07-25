import { describe, it, expect } from "vitest";
import { importProjectFile } from "./projectPackager";
import type { Clip } from "../domain/types";

// The .vidstr round-trip for Stills (ADR-0012). Export strips `file` and
// `normalized` and serializes the rest, so `kind` rides along for free — what
// needs guarding is the IMPORT side, which used to set `normalized` on every
// clip and would hand ffmpeg an image under an .mp4 name.

const dataUrl = (mime: string) => `data:${mime};base64,${btoa("pretend-bytes")}`;

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
