import { describe, expect, it } from "vitest";
import { appFontCssFamily, appFontFileName, appFontId, fontFileUrl } from "./fontLibrary";

describe("fontLibrary identifiers", () => {
  it("round-trips an app font filename", () => {
    const id = appFontId("My Display.otf");
    expect(id).toBe("app-font:My Display.otf");
    expect(appFontFileName(id)).toBe("My Display.otf");
    expect(appFontCssFamily("My Display.otf")).toBe("Vidstr_My_Display");
  });

  it("builds an encoded library URL", () => {
    expect(fontFileUrl("My Display.otf")).toBe("/api/fonts/file?name=My%20Display.otf");
    expect(appFontFileName("outfit")).toBeNull();
  });
});
