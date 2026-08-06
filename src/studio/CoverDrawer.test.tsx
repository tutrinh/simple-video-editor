// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect, useRef } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectProvider, useProject } from "../state/ProjectContext";
import { SettingsProvider } from "../state/SettingsContext";
import type { Cover, CoverTitle } from "../domain/types";
import CoverDrawer from "./CoverDrawer";
import TitleTreatmentEditor from "../features/export/TitleTreatmentEditor";
import { makeCoverTitles } from "../features/cover/coverSource";
import { installTimelineTestEnv } from "./timelineTestSetup";

// jsdom has no canvas, so the drawer's rendering is stubbed out. What is worth
// asserting here is the shell: that the gallery lists Covers, that selecting one
// switches the editor, that the upload door is present, and — the point of
// Task 8 — that the shared title editor drops its timing controls for a still.

beforeEach(() => {
  installTimelineTestEnv();
  vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("no canvas in jsdom")));
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const frame = () => new File([new Uint8Array([1, 2, 3])], "cover-frame.jpg", { type: "image/jpeg" });

function cover(over: Partial<Cover> = {}): Cover {
  return {
    id: "cv1", frame: frame(), sourceLabel: "Beat 2 @ 1.4s", aspect: "9:16",
    zoom: 1, zoomX: 0, zoomY: 0, grade: {}, stickers: [], titles: makeCoverTitles(),
    ...over,
  };
}

/** ProjectProvider takes no initial state, so seed through the reducer — which
 *  also exercises SET_CUT and ADD_COVER on the way in. */
function Seed({ covers, children }: { covers: Cover[]; children: React.ReactNode }) {
  const { state, dispatch } = useProject();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    dispatch({ type: "SET_TITLE", title: "My Trip" });
    dispatch({ type: "SET_CUT", cut: { beats: [], aspect: "9:16" } });
    covers.forEach((cover) => dispatch({ type: "ADD_COVER", cover }));
  }, [covers, dispatch]);
  return state.cut ? <>{children}</> : null;
}

function renderDrawer(covers: Cover[]) {
  return render(
    <SettingsProvider>
      <ProjectProvider>
        <Seed covers={covers}>
          <CoverDrawer open onClose={() => {}} />
        </Seed>
      </ProjectProvider>
    </SettingsProvider>,
  );
}

describe("CoverDrawer — gallery", () => {
  it("lists one entry per Cover, labelled with its provenance", () => {
    renderDrawer([cover({ id: "a", sourceLabel: "Beat 2 @ 1.4s" }), cover({ id: "b", sourceLabel: "sunset.jpg" })]);
    expect(screen.getByRole("button", { name: /Cover 1 — Beat 2 @ 1\.4s/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cover 2 — sunset\.jpg/ })).toBeTruthy();
  });

  it("shows an upload door that accepts images and not video", () => {
    const { container } = renderDrawer([]);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    expect(input.accept).toContain("image/jpeg");
    expect(input.accept).not.toContain("video");
    expect(input.accept).not.toContain("svg");
  });

  it("says so plainly when there are none", () => {
    renderDrawer([]);
    expect(screen.getByText(/No covers yet/i)).toBeTruthy();
  });

  it("selects the first Cover by default and switches on click", async () => {
    const user = userEvent.setup();
    renderDrawer([cover({ id: "a", sourceLabel: "first.jpg" }), cover({ id: "b", sourceLabel: "second.jpg" })]);
    expect(screen.getByRole("button", { name: /Cover 1 — first/ }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: /Cover 2 — second/ }));
    expect(screen.getByRole("button", { name: /Cover 2 — second/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText(/Cover preview — second\.jpg/)).toBeTruthy();
  });
});

describe("CoverDrawer — editor", () => {
  it("shows the resolution the active aspect exports at, and updates with it", async () => {
    const user = userEvent.setup();
    renderDrawer([cover({ aspect: "9:16" })]);
    expect(screen.getByText("1080 × 1920")).toBeTruthy();

    await user.click(within(screen.getByLabelText("Cover aspect ratio")).getByText("16:9"));
    expect(screen.getByText("1920 × 1080")).toBeTruthy();
    expect(screen.queryByText("1080 × 1920")).toBeNull();
  });

  it("offers all four aspects and the two delivery formats", () => {
    renderDrawer([cover()]);
    for (const label of ["16:9", "9:16", "1:1", "4:5"]) {
      expect(within(screen.getByLabelText("Cover aspect ratio")).getByText(label)).toBeTruthy();
    }
    const formats = screen.getByLabelText("Cover file format");
    expect(within(formats).getByText("JPEG")).toBeTruthy();
    expect(within(formats).getByText("PNG")).toBeTruthy();
  });

  it("exposes framing and colour as sliders", () => {
    renderDrawer([cover()]);
    for (const label of ["Zoom", "Pan X", "Pan Y", "Rotation", "Exposure", "Contrast", "Saturation"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("gives a placed sticker the Inspector's full control set", async () => {
    const user = userEvent.setup();
    renderDrawer([cover({
      stickers: [{ id: "sk1", fileName: "arrow.png", x: 0.5, y: 0.5, scale: 0.25, rotation: 0, opacity: 1 }],
    })]);
    // Rotation, Opacity and Tint are all fields CoverSticker already carried and
    // the first pass never surfaced.
    for (const label of ["Sticker x", "Sticker y", "Sticker scale", "Sticker rotation", "Sticker opacity", "Sticker tint"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText(/Remove arrow\.png/)).toBeTruthy();

    await user.click(screen.getByLabelText(/Remove arrow\.png/));
    expect(screen.getByLabelText("Rotation")).toBeTruthy(); // the Cover's own rotation, unambiguous
  });

  it("starts with the Veil off, since most covers do not need one", () => {
    renderDrawer([cover()]);
    const toggle = screen.getByRole("switch", { name: /Enable the Veil/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("Veil gradient direction")).toBeNull();
  });

  it("reveals gradient controls only in gradient mode", async () => {
    const user = userEvent.setup();
    renderDrawer([cover({ veil: { mode: "solid", color: "#000000", opacity: 0.5, toColor: "#000000", toOpacity: 0.8, direction: "down" } })]);
    expect(screen.queryByLabelText("Veil gradient direction")).toBeNull();

    await user.click(within(screen.getByLabelText("Veil fill")).getByText("Gradient"));
    expect(screen.getByLabelText("Veil gradient direction")).toBeTruthy();
  });
});

describe("TitleTreatmentEditor — showTiming", () => {
  const layers = () => makeCoverTitles().map((t) => ({ ...t, text: "HELLO", enabled: true })) as unknown as Parameters<typeof TitleTreatmentEditor>[0]["layers"];

  it("drops every timing control for a still", () => {
    render(<SettingsProvider><TitleTreatmentEditor showTiming={false} layers={layers()} onChange={() => {}} /></SettingsProvider>);
    // Scope, timed range and entry motion all describe a timeline a Cover has not got.
    expect(screen.queryByText("Timed range")).toBeNull();
    expect(screen.queryByText(/Fade out/)).toBeNull();
    expect(screen.queryByText(/Typewriter/)).toBeNull();
  });

  it("keeps them for a video title", () => {
    render(<SettingsProvider><TitleTreatmentEditor layers={layers()} onChange={() => {}} /></SettingsProvider>);
    expect(screen.getByText("Timed range")).toBeTruthy();
  });

  it("still offers the appearance controls a Cover does need", () => {
    render(<SettingsProvider><TitleTreatmentEditor showTiming={false} layers={layers()} onChange={() => {}} /></SettingsProvider>);
    expect(screen.getByDisplayValue("HELLO")).toBeTruthy();
    expect(screen.getByText(/Layer 1/)).toBeTruthy();
  });
});

describe("makeCoverTitles", () => {
  it("gives a Cover three empty layers with no timing fields on them", () => {
    const titles = makeCoverTitles();
    expect(titles).toHaveLength(3);
    for (const t of titles) {
      expect(t.enabled).toBe(false);
      expect(t.text).toBe("");
      for (const dead of ["scope", "introSec", "durationSec", "animation", "fadeOut", "typewriterCursor"]) {
        expect(dead in (t as unknown as Record<string, unknown>)).toBe(false);
      }
    }
  });

  it("gives each layer its own id", () => {
    const ids = makeCoverTitles().map((t: CoverTitle) => t.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("CoverDrawer — layout guards", () => {
  // jsdom computes no layout, so none of the overflow bugs these prevent are
  // observable here. What IS observable is whether the guards still exist —
  // which is the whole of what went wrong: a full-width drawer with content
  // written for a narrow panel, and nothing asserting otherwise.

  it("anchors the sticker picker to its button, not to the drawer", async () => {
    // .st-sticker-picker is `position: absolute; top: calc(100% + 6px)`. With no
    // positioned ancestor it resolves against the fixed .ui-drawer and lands
    // below the bottom of the whole panel — it mounts, and is invisible.
    const user = userEvent.setup();
    const { container } = renderDrawer([cover()]);
    await user.click(screen.getByLabelText("Add a sticker to this cover"));

    const picker = container.querySelector(".st-sticker-picker") as HTMLElement;
    expect(picker).toBeTruthy();
    expect((picker.parentElement as HTMLElement).style.position).toBe("relative");
  });

  it("toggles the sticker picker shut on a second click", async () => {
    const user = userEvent.setup();
    const { container } = renderDrawer([cover()]);
    const add = screen.getByLabelText("Add a sticker to this cover");
    await user.click(add);
    expect(container.querySelector(".st-sticker-picker")).toBeTruthy();
    await user.click(add);
    expect(container.querySelector(".st-sticker-picker")).toBeNull();
  });

  it("caps the canvas height so a 9:16 cover cannot run off the screen", () => {
    // Unbounded, the canvas fills its column — about half a 100vw drawer — and a
    // 9:16 cover is 16/9 of that, taller than any window.
    renderDrawer([cover({ aspect: "9:16" })]);
    const canvas = screen.getByLabelText(/Cover preview/);
    expect(canvas.style.maxHeight).toBeTruthy();
    expect(canvas.style.width).toBe("auto");
    expect(canvas.style.height).toBe("auto");
  });

  it("pads its own body, because the drawer does not", () => {
    // `.ui-drawer-body` ships padding: 0; every drawer supplies its own. Without
    // it, content sits flush to both window edges and the right-hand slider
    // values are clipped.
    const { container } = renderDrawer([cover()]);
    const body = container.querySelector(".ui-drawer-body > div") as HTMLElement;
    expect(body.style.padding).toBeTruthy();
  });
});
