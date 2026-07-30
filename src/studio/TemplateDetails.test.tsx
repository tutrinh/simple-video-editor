// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BUILT_IN_REEL_TEMPLATES } from "../features/templates/builtInTemplates";
import type { ProjectTemplate } from "../domain/types";
import TemplateDetails from "./TemplateDetails";

afterEach(cleanup);

describe("TemplateDetails reference treatment", () => {
  it("does not describe built-in reel starters as older templates", () => {
    render(<TemplateDetails template={BUILT_IN_REEL_TEMPLATES[0]} compact />);

    expect(screen.queryByText("REFERENCE VIDEO")).toBeNull();
    expect(screen.queryByText("Reference video unavailable for this older template.")).toBeNull();
  });

  it("retains the missing-reference notice for saved legacy templates", () => {
    const legacy: ProjectTemplate = {
      id: "legacy",
      name: "Legacy",
      createdAt: 1,
      updatedAt: 1,
      beats: [
        { description: "Open", approxDurationSec: 2 },
        { description: "Close", approxDurationSec: 2 },
      ],
    };

    render(<TemplateDetails template={legacy} compact />);
    expect(screen.getByText("Reference video unavailable for this older template.")).toBeTruthy();
  });
});
