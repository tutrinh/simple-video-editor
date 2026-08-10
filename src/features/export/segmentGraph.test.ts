import { describe, it, expect } from "vitest";
import {
  buildSegmentGraph,
  type StickerLayerSpec,
  type CaptionLayerSpec,
  type TitleLayerSpec,
  type OverlayLayerSpec,
  type LayerSpec,
} from "./segmentGraph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const MP4 = new Uint8Array([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70]);

function sticker(k: number, enable = `between(t,${k}.000,${k + 2}.000)`): StickerLayerSpec {
  return { kind: "sticker", pngName: `sticker_${k}.png`, png: PNG, enable };
}

function caption(k: number, enable = `between(t,${k}.000,${k + 3}.000)`): CaptionLayerSpec {
  return { kind: "caption", pngName: `cap_${k}.png`, png: PNG, enable };
}

function title(k: number, opts: Partial<Omit<TitleLayerSpec, "kind">> = {}): TitleLayerSpec {
  return {
    kind: "title",
    pngName: `title_${k}.png`,
    png: PNG,
    fadeParts: [],
    xExpr: "0",
    yExpr: "0",
    enable: "",
    ...opts,
  };
}

function overlay(k: number, opts: Partial<Omit<OverlayLayerSpec, "kind">> = {}): OverlayLayerSpec {
  return {
    kind: "overlay",
    mp4Name: `ov_seg_${k}.mp4`,
    mp4: MP4,
    overlayClip: {
      id: `ov_${k}`,
      clipId: `c_${k}`,
      startTimeSec: 0,
      durationSec: 4,
      inSec: 0,
      outSec: 4,
      blendMode: "normal",
      opacity: 1,
      volume: 0,
    },
    stLocalSec: 0,
    durLocalSec: 4,
    bStart: 0,
    segDur: 4,
    w: 1920,
    h: 1080,
    ...opts,
  };
}

const BASE_OPTS = {
  inputIndexBase: 1,
  baseLabel: "[vbase]",
  segDurStr: "4.000",
  rgbFormat: null,
} as const;

// ---------------------------------------------------------------------------
// Zero-layer graph
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — zero layers", () => {
  it("returns empty inputs, inputArgs, chains when no layers are given", () => {
    const result = buildSegmentGraph([], BASE_OPTS);
    expect(result.inputs).toHaveLength(0);
    expect(result.inputArgs).toHaveLength(0);
    expect(result.chains).toHaveLength(0);
    expect(result.inputCount).toBe(0);
  });

  it("returns lastLabel === baseLabel when there are no layers", () => {
    const result = buildSegmentGraph([], BASE_OPTS);
    expect(result.lastLabel).toBe("[vbase]");
  });

  it("does NOT emit [v] itself — caller must direct its base chain to [v]", () => {
    const result = buildSegmentGraph([], BASE_OPTS);
    expect(result.chains.join(";")).not.toContain("[v]");
  });
});

// ---------------------------------------------------------------------------
// One sticker
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — single sticker", () => {
  const result = buildSegmentGraph([sticker(0)], BASE_OPTS);

  it("adds exactly one input and one inputArgs set", () => {
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].name).toBe("sticker_0.png");
    // 6 argv tokens per looped input: -loop 1 -t dur -r 30 -i name
    expect(result.inputArgs).toHaveLength(8);
  });

  it("produces exactly one chain", () => {
    expect(result.chains).toHaveLength(1);
  });

  it("uses inputIndexBase as the input index in the chain", () => {
    expect(result.chains[0]).toContain("[1:v]");
  });

  it("reads from baseLabel", () => {
    expect(result.chains[0]).toMatch(/^\[vbase\]/);
  });

  it("the only chain emits [v]", () => {
    const chain = result.chains[0];
    expect(chain).toMatch(/\[v\]$/);
  });

  it("exactly one [v] emitter", () => {
    const emitters = result.chains.filter((c) => /\[v\]$/.test(c.trim()));
    expect(emitters).toHaveLength(1);
  });

  it("inputCount is 1", () => {
    expect(result.inputCount).toBe(1);
  });

  it("lastLabel is [v]", () => {
    expect(result.lastLabel).toBe("[v]");
  });

  it("carries the enable expression into the chain", () => {
    expect(result.chains[0]).toContain("enable='between(t,0.000,2.000)'");
  });
});

// ---------------------------------------------------------------------------
// Multiple stickers
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — multiple stickers", () => {
  const layers: LayerSpec[] = [sticker(0), sticker(1), sticker(2)];
  const result = buildSegmentGraph(layers, { ...BASE_OPTS, inputIndexBase: 3 });

  it("assigns consecutive input indices starting at inputIndexBase", () => {
    expect(result.chains[0]).toContain("[3:v]");
    expect(result.chains[1]).toContain("[4:v]");
    expect(result.chains[2]).toContain("[5:v]");
  });

  it("only the LAST chain emits [v]", () => {
    const emitters = result.chains.filter((c) => /\[v\]$/.test(c.trim()));
    expect(emitters).toHaveLength(1);
    expect(result.chains[2]).toMatch(/\[v\]$/);
  });

  it("intermediate chains use [vsticker_k] labels", () => {
    expect(result.chains[0]).toContain("[vsticker_0]");
    expect(result.chains[1]).toContain("[vsticker_1]");
  });

  it("chains form a linear sequence: each chain reads from the previous output", () => {
    // chain[0] emits [vsticker_0], chain[1] must start with [vsticker_0]
    expect(result.chains[1]).toContain("[vsticker_0]");
    expect(result.chains[2]).toContain("[vsticker_1]");
  });

  it("inputCount equals the number of layers", () => {
    expect(result.inputCount).toBe(3);
  });

  it("inputCount matches the number of -i flags in inputArgs", () => {
    const iFlags = result.inputArgs.filter((a) => a === "-i").length;
    expect(iFlags).toBe(result.inputCount);
  });

  it("adds inputs for every sticker", () => {
    expect(result.inputs).toHaveLength(3);
    expect(result.inputs.map((inp) => inp.name)).toEqual(["sticker_0.png", "sticker_1.png", "sticker_2.png"]);
  });
});

// ---------------------------------------------------------------------------
// inputCount matches argv -i count (invariant asserted for any size)
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — inputCount === -i count invariant", () => {
  for (const n of [0, 1, 2, 5]) {
    it(`holds for ${n} sticker(s)`, () => {
      const layers = Array.from({ length: n }, (_, k) => sticker(k));
      const result = buildSegmentGraph(layers, BASE_OPTS);
      const iFlags = result.inputArgs.filter((a) => a === "-i").length;
      expect(iFlags).toBe(result.inputCount);
      expect(result.inputs).toHaveLength(result.inputCount);
    });
  }
});

// ---------------------------------------------------------------------------
// baseLabel threading
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — baseLabel threading", () => {
  it("threads a custom baseLabel into the first chain", () => {
    const result = buildSegmentGraph([sticker(0)], { ...BASE_OPTS, baseLabel: "[mycustom]" });
    expect(result.chains[0]).toMatch(/^\[mycustom\]/);
  });

  it("different inputIndexBase values produce correct -i references", () => {
    const result5 = buildSegmentGraph([sticker(0)], { ...BASE_OPTS, inputIndexBase: 5 });
    expect(result5.chains[0]).toContain("[5:v]");

    const result10 = buildSegmentGraph([sticker(0)], { ...BASE_OPTS, inputIndexBase: 10 });
    expect(result10.chains[0]).toContain("[10:v]");
  });
});

// ---------------------------------------------------------------------------
// Caption Layer (Task 3)
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — single caption (terminal)", () => {
  const result = buildSegmentGraph([caption(0)], BASE_OPTS);

  it("produces exactly one chain", () => expect(result.chains).toHaveLength(1));
  it("uses inputIndexBase as the input index", () => expect(result.chains[0]).toContain("[1:v]"));
  it("reads from baseLabel", () => expect(result.chains[0]).toMatch(/^\[vbase\]/));
  it("last chain emits [v] when terminal (default)", () => expect(result.chains[0]).toMatch(/\[v\]$/));
  it("lastLabel is [v]", () => expect(result.lastLabel).toBe("[v]"));
  it("inputCount is 1", () => expect(result.inputCount).toBe(1));
  it("inputCount matches -i count", () => {
    const iFlags = result.inputArgs.filter((a) => a === "-i").length;
    expect(iFlags).toBe(1);
  });
  it("carries the enable expression", () => {
    expect(result.chains[0]).toContain("enable='between(t,0.000,3.000)'");
  });
  it("uses [vcap_k] intermediate labels (not [vlayer_k])", () => {
    // With one item, it goes straight to [v]. Check by using two captions.
    const r2 = buildSegmentGraph([caption(0), caption(1)], BASE_OPTS);
    expect(r2.chains[0]).toContain("[vcap_0]");
    expect(r2.chains[1]).toMatch(/\[v\]$/);
  });
});

describe("buildSegmentGraph — caption with empty enable", () => {
  it("omits the enable clause when enable is an empty string", () => {
    const layer: CaptionLayerSpec = { kind: "caption", pngName: "cap_0.png", png: PNG, enable: "" };
    const result = buildSegmentGraph([layer], BASE_OPTS);
    expect(result.chains[0]).not.toContain("enable");
    // The chain should have eof_action=pass immediately followed by [v]
    expect(result.chains[0]).toContain("eof_action=pass[v]");
  });
});

describe("buildSegmentGraph — terminal: false (non-terminal caption call)", () => {
  const result = buildSegmentGraph([caption(0)], { ...BASE_OPTS, terminal: false });

  it("does NOT emit [v] when terminal is false", () => {
    expect(result.chains.join(";")).not.toContain("[v]");
  });

  it("last chain emits [vcap_0] when terminal is false", () => {
    expect(result.chains[0]).toContain("[vcap_0]");
  });

  it("lastLabel is the intermediate label, not [v]", () => {
    expect(result.lastLabel).toBe("[vcap_0]");
  });

  it("zero-layer result is unaffected by terminal flag", () => {
    const r = buildSegmentGraph([], { ...BASE_OPTS, terminal: false });
    expect(r.lastLabel).toBe("[vbase]");
    expect(r.chains).toHaveLength(0);
  });
});

describe("buildSegmentGraph — mixed Caption + Sticker (two-member interface)", () => {
  // Captions and stickers are structurally identical: both use overlay+enable.
  // This suite exercises the module with both kinds in one call.
  const layers: LayerSpec[] = [caption(0), sticker(0)];
  const result = buildSegmentGraph(layers, { ...BASE_OPTS, inputIndexBase: 1 });

  it("processes both kinds in order", () => {
    expect(result.chains).toHaveLength(2);
  });

  it("caption comes first and uses [vcap_0]", () => {
    expect(result.chains[0]).toContain("[vcap_0]");
  });

  it("sticker comes second and reads [vcap_0]", () => {
    expect(result.chains[1]).toContain("[vcap_0]");
  });

  it("sticker is last and emits [v]", () => {
    expect(result.chains[1]).toMatch(/\[v\]$/);
  });

  it("input indices are consecutive: caption=1, sticker=2", () => {
    expect(result.chains[0]).toContain("[1:v]");
    expect(result.chains[1]).toContain("[2:v]");
  });

  it("inputCount is 2", () => {
    expect(result.inputCount).toBe(2);
  });

  it("inputCount matches -i count invariant", () => {
    const iFlags = result.inputArgs.filter((a) => a === "-i").length;
    expect(iFlags).toBe(result.inputCount);
  });
});

describe("buildSegmentGraph — inputCount === -i count invariant (captions)", () => {
  for (const n of [0, 1, 2, 4]) {
    it(`holds for ${n} caption(s)`, () => {
      const layers = Array.from({ length: n }, (_, k) => caption(k));
      const result = buildSegmentGraph(layers, BASE_OPTS);
      const iFlags = result.inputArgs.filter((a) => a === "-i").length;
      expect(iFlags).toBe(result.inputCount);
      expect(result.inputs).toHaveLength(result.inputCount);
    });
  }
});

// ---------------------------------------------------------------------------
// Title Layer (Task 4)
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — single title (no fade, no enable, terminal)", () => {
  const result = buildSegmentGraph([title(0)], BASE_OPTS);

  it("produces TWO chains per title (format/fade chain + overlay chain)", () => {
    expect(result.chains).toHaveLength(2);
  });

  it("first chain is the image format chain referencing the input index", () => {
    expect(result.chains[0]).toMatch(/^\[1:v\]format=rgba/);
  });

  it("first chain emits [ovt_0]", () => {
    expect(result.chains[0]).toContain("[ovt_0]");
  });

  it("second chain is the overlay composite reading [ovt_0]", () => {
    expect(result.chains[1]).toContain("[ovt_0]overlay");
  });

  it("second chain reads from baseLabel", () => {
    expect(result.chains[1]).toMatch(/^\[vbase\]/);
  });

  it("second chain emits [v] when terminal (default)", () => {
    expect(result.chains[1]).toMatch(/\[v\]$/);
  });

  it("lastLabel is [v]", () => {
    expect(result.lastLabel).toBe("[v]");
  });

  it("inputCount is 1 (one PNG input per title)", () => {
    expect(result.inputCount).toBe(1);
  });

  it("inputCount matches -i count", () => {
    const iFlags = result.inputArgs.filter((a) => a === "-i").length;
    expect(iFlags).toBe(1);
  });

  it("no enable clause when enable is empty string", () => {
    // overlay chain should NOT contain :enable=
    expect(result.chains[1]).not.toContain("enable");
  });
});

describe("buildSegmentGraph — title with fadeParts", () => {
  const fade = "fade=t=in:st=0:d=0.500:alpha=1";
  const result = buildSegmentGraph(
    [title(0, { fadeParts: [fade] })],
    BASE_OPTS,
  );

  it("folds fadeParts into the format chain with commas", () => {
    expect(result.chains[0]).toContain(`format=rgba,${fade}[ovt_0]`);
  });

  it("still produces exactly 2 chains", () => {
    expect(result.chains).toHaveLength(2);
  });
});

describe("buildSegmentGraph — title with enable clause", () => {
  const result = buildSegmentGraph(
    [title(0, { enable: ":enable='between(t,0,3)'" })],
    BASE_OPTS,
  );

  it("appends the enable fragment (with leading colon) to the overlay chain", () => {
    expect(result.chains[1]).toContain(":enable='between(t,0,3)'");
  });
});

describe("buildSegmentGraph — title with position expressions", () => {
  const result = buildSegmentGraph(
    [title(0, { xExpr: "if(lt(t,0.5),100,0)", yExpr: "50" })],
    BASE_OPTS,
  );

  it("uses xExpr and yExpr in the overlay chain", () => {
    expect(result.chains[1]).toContain("x='if(lt(t,0.5),100,0)'");
    expect(result.chains[1]).toContain("y='50'");
  });
});

describe("buildSegmentGraph — title terminal: false", () => {
  const result = buildSegmentGraph([title(0)], { ...BASE_OPTS, terminal: false });

  it("does NOT emit [v] when terminal is false", () => {
    expect(result.chains.join(";")).not.toContain("[v]");
  });

  it("emits [vtitle_0] as the last output", () => {
    expect(result.chains[1]).toContain("[vtitle_0]");
  });

  it("lastLabel is [vtitle_0]", () => {
    expect(result.lastLabel).toBe("[vtitle_0]");
  });
});

describe("buildSegmentGraph — two titles: chain sequencing and label threading", () => {
  const layers: LayerSpec[] = [title(0), title(1)];
  const result = buildSegmentGraph(layers, { ...BASE_OPTS, inputIndexBase: 2 });

  it("produces 4 chains (2 per title)", () => {
    expect(result.chains).toHaveLength(4);
  });

  it("title 0 image chain uses index 2, emits [ovt_0]", () => {
    expect(result.chains[0]).toMatch(/^\[2:v\]format=rgba\[ovt_0\]/);
  });

  it("title 0 overlay chain reads [vbase] and [ovt_0], emits [vtitle_0]", () => {
    expect(result.chains[1]).toMatch(/^\[vbase\]\[ovt_0\]overlay.*\[vtitle_0\]$/);
  });

  it("title 1 image chain uses index 3, emits [ovt_1]", () => {
    expect(result.chains[2]).toMatch(/^\[3:v\]format=rgba\[ovt_1\]/);
  });

  it("title 1 overlay chain reads [vtitle_0] and [ovt_1], emits [v]", () => {
    expect(result.chains[3]).toMatch(/^\[vtitle_0\]\[ovt_1\]overlay.*\[v\]$/);
  });

  it("inputCount is 2", () => {
    expect(result.inputCount).toBe(2);
  });
});

describe("buildSegmentGraph — mixed Caption + Title + Sticker (three-member pipeline)", () => {
  // Models the full Task 4 pipeline: caption (non-terminal), title (non-terminal), sticker (terminal).
  // In practice the caller makes three separate module calls; here we test a single call
  // with all three in sequence to verify the interface holds three kinds without widening.
  const layers: LayerSpec[] = [caption(0), title(0), sticker(0)];
  const result = buildSegmentGraph(layers, { ...BASE_OPTS, inputIndexBase: 1 });

  it("produces 4 chains: 1 (caption) + 2 (title) + 1 (sticker)", () => {
    expect(result.chains).toHaveLength(4);
  });

  it("input indices are consecutive: 1, 2, 3", () => {
    // caption at 1, title at 2, sticker at 3
    expect(result.chains[0]).toContain("[1:v]"); // caption overlay
    expect(result.chains[1]).toContain("[2:v]"); // title format
    expect(result.chains[3]).toContain("[3:v]"); // sticker overlay
  });

  it("only the last chain emits [v]", () => {
    const emitters = result.chains.filter((c) => /\[v\]$/.test(c.trim()));
    expect(emitters).toHaveLength(1);
    expect(result.chains[3]).toMatch(/\[v\]$/);
  });

  it("inputCount is 3 and matches -i count", () => {
    expect(result.inputCount).toBe(3);
    expect(result.inputArgs.filter((a) => a === "-i")).toHaveLength(3);
  });
});

describe("buildSegmentGraph — inputCount === -i count invariant (titles)", () => {
  for (const n of [0, 1, 2, 3]) {
    it(`holds for ${n} title(s)`, () => {
      const layers = Array.from({ length: n }, (_, k) => title(k));
      const result = buildSegmentGraph(layers, BASE_OPTS);
      const iFlags = result.inputArgs.filter((a) => a === "-i").length;
      expect(iFlags).toBe(result.inputCount);
      expect(result.inputs).toHaveLength(result.inputCount);
    });
  }
});

// ---------------------------------------------------------------------------
// Overlay Layer (Task 5)
// ---------------------------------------------------------------------------

describe("buildSegmentGraph — single normal overlay (terminal)", () => {
  const result = buildSegmentGraph([overlay(0)], BASE_OPTS);

  it("produces inputArgs with -i mp4Name (no -loop or -t flags)", () => {
    expect(result.inputArgs).toEqual(["-i", "ov_seg_0.mp4"]);
  });

  it("adds one mp4 input", () => {
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].name).toBe("ov_seg_0.mp4");
  });

  it("terminal normal overlay chain emits [v]", () => {
    expect(result.chains[result.chains.length - 1]).toMatch(/\[v\]$/);
  });

  it("lastLabel is [v]", () => {
    expect(result.lastLabel).toBe("[v]");
  });

  it("inputCount is 1", () => {
    expect(result.inputCount).toBe(1);
  });
});

describe("buildSegmentGraph — picture-in-picture overlay", () => {
  const layer = overlay(0, {
    overlayClip: {
      id: "pip",
      clipId: "c_0",
      startTimeSec: 0,
      durationSec: 4,
      inSec: 0,
      outSec: 4,
      blendMode: "normal",
      opacity: 1,
      volume: 0,
      layoutMode: "pip",
      x: 0.8,
      y: 0.2,
      width: 0.3,
      height: 0.25,
      fit: "cover",
      cornerRadius: 0.1,
    },
  });

  it("scales and crops into the PiP box, rounds it, and overlays at its authored position", () => {
    const chain = buildSegmentGraph([layer], BASE_OPTS).chains.join(";");
    expect(chain).toContain("scale=576:270:force_original_aspect_ratio=increase,crop=576:270");
    expect(chain).toContain("colorchannelmixer=aa=1.000");
    expect(chain).toContain("geq=");
    expect(chain).toContain("overlay=x=1248:y=81");
  });
});

describe("buildSegmentGraph — blend mode overlay with rgbFormat", () => {
  const layer = overlay(0, {
    overlayClip: {
      id: "ov_0",
      clipId: "c_0",
      startTimeSec: 0,
      durationSec: 4,
      inSec: 0,
      outSec: 4,
      blendMode: "screen",
      opacity: 0.85,
      volume: 0,
    },
  });

  it("appends format=gbrp to base and blend filter, plus format=yuv420p post-conversion", () => {
    const result = buildSegmentGraph([layer], { ...BASE_OPTS, rgbFormat: "gbrp" });
    const chainStr = result.chains.join(";");
    expect(chainStr).toContain("format=gbrp");
    expect(chainStr).toContain("blend=all_mode=screen:all_opacity=0.850");
    expect(chainStr).toContain("format=yuv420p[v]");
    expect(result.lastLabel).toBe("[v]");
  });

  it("non-terminal blend mode overlay emits [vrgbout] after format=yuv420p", () => {
    const result = buildSegmentGraph([layer], { ...BASE_OPTS, rgbFormat: "gbrp", terminal: false });
    const lastChain = result.chains[result.chains.length - 1];
    expect(lastChain).toContain("format=yuv420p[vrgbout]");
    expect(result.lastLabel).toBe("[vrgbout]");
  });
});

describe("buildSegmentGraph — full 4-layer pipeline (Caption + Title + Overlay + Sticker)", () => {
  const layers: LayerSpec[] = [
    caption(0),
    title(0),
    overlay(0),
    sticker(0),
  ];
  const result = buildSegmentGraph(layers, BASE_OPTS);

  it("assigns consecutive input indices starting at inputIndexBase", () => {
    // caption=1, title=2, overlay=3, sticker=4
    const chainStr = result.chains.join(";");
    expect(chainStr).toContain("[1:v]");
    expect(chainStr).toContain("[2:v]");
    expect(chainStr).toContain("[3:v]");
    expect(chainStr).toContain("[4:v]");
  });

  it("only the final chain (sticker) emits [v]", () => {
    const emitters = result.chains.filter((c) => /\[v\]$/.test(c.trim()));
    expect(emitters).toHaveLength(1);
    expect(result.chains[result.chains.length - 1]).toMatch(/\[v\]$/);
  });

  it("inputCount is 4 and matches -i count", () => {
    expect(result.inputCount).toBe(4);
    const iFlags = result.inputArgs.filter((a) => a === "-i").length;
    expect(iFlags).toBe(4);
  });
});

describe("buildSegmentGraph — inputCount === -i count invariant (overlays)", () => {
  for (const n of [0, 1, 2, 3]) {
    it(`holds for ${n} overlay(s)`, () => {
      const layers = Array.from({ length: n }, (_, k) => overlay(k));
      const result = buildSegmentGraph(layers, BASE_OPTS);
      const iFlags = result.inputArgs.filter((a) => a === "-i").length;
      expect(iFlags).toBe(result.inputCount);
      expect(result.inputs).toHaveLength(result.inputCount);
    });
  }
});
