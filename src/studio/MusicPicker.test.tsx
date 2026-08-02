// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MusicPicker from "./MusicPicker";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MusicPicker", () => {
  it("permanently deletes a confirmed file from the shared library", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200, json: async () => ({ files: ["shared.wav"] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const onDelete = vi.fn();

    render(<MusicPicker onPick={() => {}} onImport={() => {}} onClose={() => {}} onDelete={onDelete} />);
    const deleteButton = await screen.findByRole("button", { name: "Delete shared.wav from Music library" });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("shared.wav"));
    expect(fetchMock).toHaveBeenCalledWith("/api/music/file?name=shared.wav", { method: "DELETE" });
    expect(screen.queryByText("shared.wav")).toBeNull();
  });
});
