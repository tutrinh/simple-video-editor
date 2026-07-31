// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectProvider } from "../state/ProjectContext";
import { SettingsProvider } from "../state/SettingsContext";
import MotivationalStoryView from "./MotivationalStoryView";

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ProjectProvider>
      <SettingsProvider>{ui}</SettingsProvider>
    </ProjectProvider>
  );
}

describe("MotivationalStoryView", () => {
  it("renders prompt input, target duration, AI engine controls and handles generation", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(
      JSON.stringify({
        title: "Discipline First",
        hook: "Show up every day.",
        beats: [
          {
            purpose: "hook",
            scriptText: "Show up every single day.",
            approxDurationSec: 5,
            shotDescription: "Close up of running shoes",
          },
        ],
      })
    );

    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    expect(screen.getByText("🔥 Motivational Story")).toBeTruthy();
    expect(screen.getByText("Motivational Prompt")).toBeTruthy();

    const generateBtn = screen.getByText("⚡ Generate Story Plan");
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(mockAuthor).toHaveBeenCalled();
      expect(screen.getByText("Discipline First")).toBeTruthy();
    });

    expect(screen.getByText("🚀 Apply to Project")).toBeTruthy();
  });
});
