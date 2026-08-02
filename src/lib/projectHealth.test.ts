import { describe, expect, it } from "vitest";
import { projectHealthIssues } from "./projectHealth";

describe("project health", () => {
  it("finds relinkable media and broken timeline references but ignores intentional placeholders", () => {
    const issues = projectHealthIssues({
      title: "Broken",
      direction: "",
      clips: [
        { id: "missing", name: "lost.mp4", file: undefined as never, durationSec: 2, width: 10, height: 10 },
        { id: "placeholder", name: "Empty", file: new File([], "empty.mp4"), durationSec: 2, width: 10, height: 10, isTemplatePlaceholder: true },
      ],
      cut: { aspect: "9:16", beats: [{ id: "b", clipId: "gone", inSec: 0, outSec: 2, durationSec: 2, scriptText: "", captionText: "" }] },
    });
    expect(issues.map((issue) => issue.code)).toEqual(["missing-clip-media", "missing-reference"]);
  });
});
