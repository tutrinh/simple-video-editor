import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteMusic, fetchMusicFile, fetchMusicList, musicFileUrl, uploadMusic } from "./musicLibrary";

afterEach(() => vi.unstubAllGlobals());

describe("app-wide Music library", () => {
  it("lists, addresses, fetches, and uploads shared audio by filename", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/music/list") {
        return { ok: true, json: async () => ({ files: ["shared.wav"] }) };
      }
      if (url === "/api/music/file?name=shared.wav" && init?.method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ ok: true, name: "shared.wav" }) };
      }
      if (url === "/api/music/file?name=shared.wav") {
        return { ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }) };
      }
      if (url === "/api/music/upload?name=shared.wav" && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true, name: "shared.wav" }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchMusicList()).toEqual(["shared.wav"]);
    expect(musicFileUrl("shared.wav")).toBe("/api/music/file?name=shared.wav");
    const file = await fetchMusicFile("shared.wav");
    expect(file).toMatchObject({ name: "shared.wav", type: "audio/wav", size: 3 });
    expect(fetchMock).toHaveBeenCalledWith("/api/music/file?name=shared.wav", { cache: "no-store" });
    expect(await uploadMusic(file)).toBe("shared.wav");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ method: "POST", body: file });
    await deleteMusic("shared.wav");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ method: "DELETE" });
  });
});
