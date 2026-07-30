// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Clip, ProjectTemplate } from "../domain/types";
import { ProjectProvider } from "../state/ProjectContext";
import { SettingsProvider } from "../state/SettingsContext";
import TemplateApplyModal from "./TemplateApplyModal";

const aiMocks = vi.hoisted(() => ({
  analyzeClip: vi.fn(),
  callClaude: vi.fn(),
}));

vi.mock("../features/analyze/analyze", () => ({
  analyzeClip: aiMocks.analyzeClip,
}));

vi.mock("../lib/claudeClient", () => ({
  callClaude: aiMocks.callClaude,
}));

const template: ProjectTemplate = {
  id: "product-review",
  name: "Product Review Reel",
  createdAt: 0,
  updatedAt: 0,
  aspect: "9:16",
  beats: [
    { description: "Open with the product problem", approxDurationSec: 3 },
    { description: "Show the result", approxDurationSec: 4 },
  ],
};

function clip(id: string, action: string): Clip {
  return {
    id,
    file: new File([], `${id}.mp4`, { type: "video/mp4" }),
    name: `${id}.mp4`,
    durationSec: 8,
    width: 1080,
    height: 1920,
    description: {
      subjectAction: action,
      settingMood: "bright studio",
      usability: 4,
      model: "test",
      raw: action,
    },
  };
}

function renderModal(clips: Clip[], onApplied = vi.fn()) {
  render(
    <SettingsProvider>
      <ProjectProvider>
        <TemplateApplyModal
          template={template}
          clips={clips}
          onClose={vi.fn()}
          onApplied={onApplied}
        />
      </ProjectProvider>
    </SettingsProvider>,
  );
  return { onApplied };
}

describe("TemplateApplyModal AI coverage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, String(value)),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
      } satisfies Storage,
    });
    aiMocks.analyzeClip.mockReset();
    aiMocks.callClaude.mockReset();
  });

  it("autofills confident matches and exposes an actionable coverage gap", async () => {
    aiMocks.callClaude.mockResolvedValue(JSON.stringify({
      recommendations: [
        {
          beatIndex: 0,
          clipId: "problem",
          confidence: 0.91,
          reason: "The creator visibly demonstrates the problem.",
        },
        {
          beatIndex: 1,
          clipId: "",
          confidence: 0.2,
          reason: "No result footage is available.",
          missingShot: "Film the finished result in a tight close-up.",
        },
      ],
    }));
    renderModal([
      clip("problem", "Creator struggles with the product problem"),
      clip("detail", "Static close-up of product packaging"),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Analyze & Autofill" }));

    expect(await screen.findByText("1 matched")).toBeTruthy();
    expect(screen.getByText("1 missing")).toBeTruthy();
    expect(screen.getByText("91% match")).toBeTruthy();
    expect(screen.getByText("Needs shot")).toBeTruthy();
    expect(screen.getByText(/Film the finished result in a tight close-up/)).toBeTruthy();
    expect(
      (screen.getByRole("combobox", { name: /Clip for Beat 1/ }) as HTMLSelectElement).value,
    ).toBe("problem");
    expect(
      (screen.getByRole("combobox", { name: /Clip for Beat 2/ }) as HTMLSelectElement).value,
    ).toBe("");
    expect(aiMocks.analyzeClip).not.toHaveBeenCalled();
  });

  it("keeps manual overrides possible and applies through the existing template seam", async () => {
    aiMocks.callClaude.mockResolvedValue(JSON.stringify({
      recommendations: [
        { beatIndex: 0, clipId: "problem", confidence: 0.9, reason: "Clear problem shot." },
        { beatIndex: 1, clipId: "", confidence: 0.1, reason: "No result shot." },
      ],
    }));
    const { onApplied } = renderModal([
      clip("problem", "Creator demonstrates a problem"),
      clip("result", "Finished product on a table"),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Analyze & Autofill" }));
    await screen.findByText("Needs shot");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Clip for Beat 2/ }),
      "result",
    );

    expect(screen.getByText("Manual")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Apply Template" }));
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("analyzes only Clips that do not already have reusable descriptions", async () => {
    const rawClip = { ...clip("raw", "unused"), description: undefined };
    aiMocks.analyzeClip.mockResolvedValue({
      subjectAction: "Creator reveals the product",
      settingMood: "home desk",
      usability: 5,
      model: "test-analyzer",
      raw: "Creator reveals the product",
    });
    aiMocks.callClaude.mockResolvedValue(JSON.stringify({
      recommendations: [
        { beatIndex: 0, clipId: "raw", confidence: 0.95, reason: "Strong opening reveal." },
        { beatIndex: 1, clipId: "described", confidence: 0.85, reason: "The result is visible." },
      ],
    }));
    renderModal([
      rawClip,
      clip("described", "Creator shows the finished result"),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Analyze & Autofill" }));

    expect(await screen.findByText("2 matched")).toBeTruthy();
    expect(aiMocks.analyzeClip).toHaveBeenCalledOnce();
    expect(aiMocks.analyzeClip).toHaveBeenCalledWith(
      rawClip,
      expect.objectContaining({ provider: "claude" }),
    );
  });
});
