import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve("src/studio/studio.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

describe("template slot suggestion layout", () => {
  it("allows long AI suggestions to shrink and wrap inside the Inspector card", () => {
    const card = rule(".st-template-slot-card");
    const row = rule(".st-template-slot-suggestion");
    const copy = rule(".st-template-slot-suggestion > span");

    expect(card).toContain("flex: 0 0 auto");
    expect(row).toContain("min-width: 0");
    expect(row).toContain("max-width: 100%");
    expect(row).toContain("box-sizing: border-box");
    expect(row).toContain("white-space: normal");
    expect(copy).toContain("min-width: 0");
    expect(copy).toContain("overflow-wrap: anywhere");
  });
});
