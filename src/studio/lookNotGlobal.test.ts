import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A source-level regression guard, not a behavioural test. Deriving a Look must
// never write it to the global override (ADR-0010): `analyzeFilmLook` asks Claude
// for the values that push *neutral* footage toward the reference, so applying
// them flat to footage that is nowhere near neutral overshoots into the rails.
// Only `applyLookToBeats` may act on a Look, and it grades each Beat toward it.
//
// This lives at source level because the offending calls are inside a React
// component with no test harness, and the defect is the *presence* of a call.

const SRC = readFileSync(join(__dirname, "FilterPresetModal.tsx"), "utf8");

/** The body of a named function declaration, brace-matched. */
function bodyOf(name: string): string {
  const start = SRC.search(new RegExp(`(async )?function ${name}\\s*\\(`));
  expect(start, `${name} not found in FilterPresetModal.tsx`).toBeGreaterThan(-1);
  let i = SRC.indexOf("{", start);
  let depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(i, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe("deriving a Look never writes the global override", () => {
  for (const fn of ["analyzeLook", "loadSavedReference"]) {
    it(`${fn} does not call onSelectFilter`, () => {
      expect(bodyOf(fn)).not.toContain("onSelectFilter");
    });

    it(`${fn} does not set the global fine-tune`, () => {
      expect(bodyOf(fn)).not.toContain("setFineTuneAdj");
    });

    it(`${fn} still records the Look itself`, () => {
      expect(bodyOf(fn)).toContain("setLook");
    });
  }
});

describe("applying a Look is still the path that acts on it", () => {
  it("applyLookToBeats clears the global before grading", () => {
    const body = bodyOf("applyLookToBeats");
    expect(body).toContain("clearedGlobal");
    expect(body).toContain("onSelectFilter");
    // The clear must precede the grading loop, or the Look lands twice.
    expect(body.indexOf("clearedGlobal")).toBeLessThan(body.indexOf("gradeBeatToLook"));
  });

  it("undoGrade restores the global it cleared", () => {
    const body = bodyOf("undoGrade");
    expect(body).toContain("restoredGlobal");
    expect(body).toContain("onSelectFilter");
  });
});
