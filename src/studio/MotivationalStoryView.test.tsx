// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectProvider } from "../state/ProjectContext";
import { SCRIPT_TYPE_OPTIONS, SettingsProvider, TONE_OPTIONS, toneHint } from "../state/SettingsContext";
import MotivationalStoryView from "./MotivationalStoryView";

// This project runs vitest without `globals: true`, so Testing Library's automatic
// afterEach cleanup never registers. Without it, renders accumulate in the same
// document and React's useId values collide across roots, breaking label lookups.
afterEach(() => {
  cleanup();
});

// This environment's localStorage is only partially implemented (no setItem/clear),
// so saved-plan history silently no-ops without a real stand-in.
beforeEach(() => {
  let store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      length: 0,
      key: () => null,
    },
    writable: true,
    configurable: true,
  });
});

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

  it("keeps Tone/Format as shared setting ids and sends their hint phrases to the author", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(
      JSON.stringify({ title: "T", hook: "H", beats: [{ scriptText: "x", shotDescription: "y" }] })
    );

    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    // The selects must carry ids ("casual"), not display labels ("Inspiring") —
    // every other AI feature reads these settings through toneHint()/scriptTypeHint().
    const toneSelect = screen.getByLabelText("Tone / Voice") as HTMLSelectElement;
    const formatSelect = screen.getByLabelText("Format") as HTMLSelectElement;
    const toneValues = [...toneSelect.options].map((o) => o.value);
    const formatValues = [...formatSelect.options].map((o) => o.value);

    expect(toneValues).toEqual(TONE_OPTIONS.map((t) => t.id));
    expect(formatValues).toEqual(SCRIPT_TYPE_OPTIONS.map((s) => s.id));
    expect(toneSelect.value).toBe("casual");

    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));

    await waitFor(() => expect(mockAuthor).toHaveBeenCalled());
    const sentPrompt = mockAuthor.mock.calls[0][0] as string;
    expect(sentPrompt).toContain(toneHint("casual"));
    expect(sentPrompt).not.toMatch(/TONE \/ VOICE: casual\n/);
  });
});

describe("MotivationalStoryView persona controls", () => {
  const okResponse = JSON.stringify({
    title: "T",
    hook: "H",
    beats: [{ scriptText: "x", shotDescription: "y" }],
  });

  it("defaults to Auto and tells the model to invent a persona", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(okResponse);
    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    expect((screen.getByLabelText("Persona") as HTMLSelectElement).value).toBe("auto");

    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));
    await waitFor(() => expect(mockAuthor).toHaveBeenCalled());
    expect(mockAuthor.mock.calls[0][0]).toMatch(/invent ONE specific person/i);
  });

  it("sends a selected preset's speaker and world into the prompt", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(okResponse);
    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "night-shift-boards" } });
    expect(screen.getByText(/med-surg nurse/i)).toBeTruthy();

    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));
    await waitFor(() => expect(mockAuthor).toHaveBeenCalled());

    const sent = mockAuthor.mock.calls[0][0] as string;
    expect(sent).toContain("3AM ward lighting");
    expect(sent).toContain("FIRST PERSON");
  });

  it("applies a point-of-view override on top of the preset", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(okResponse);
    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "night-shift-boards" } });
    fireEvent.change(screen.getByLabelText("Point of view"), { target: { value: "third-person" } });

    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));
    await waitFor(() => expect(mockAuthor).toHaveBeenCalled());
    expect(mockAuthor.mock.calls[0][0]).toContain("THIRD PERSON");
  });

  it("reveals custom persona fields and sends them to the author", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(okResponse);
    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    // These fields carry help text, which is inside the <label> — so match on a
    // substring rather than the label's full text content.
    expect(screen.queryByLabelText(/Who is speaking\?/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "custom" } });

    fireEvent.change(screen.getByLabelText(/Who is speaking\?/), {
      target: { value: "A 34-year-old line cook taking 6AM classes" },
    });
    fireEvent.change(screen.getByLabelText(/Their world/), {
      target: { value: "burn scars on a forearm, a 5:10 bus" },
    });

    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));
    await waitFor(() => expect(mockAuthor).toHaveBeenCalled());

    const sent = mockAuthor.mock.calls[0][0] as string;
    expect(sent).toContain("A 34-year-old line cook taking 6AM classes");
    expect(sent).toContain("burn scars on a forearm");
    expect(sent).toContain("a 5:10 bus");
  });

  it("restores the persona steer when a saved plan is loaded from history", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(okResponse);
    const { unmount } = renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "acl-comeback" } });
    fireEvent.change(screen.getByLabelText("Point of view"), { target: { value: "second-person" } });
    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));
    await waitFor(() => expect(mockAuthor).toHaveBeenCalled());
    unmount();

    // Fresh drawer, empty project state: the plan comes back only via saved history.
    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);
    fireEvent.click(screen.getByText("📜 Saved Plans"));
    fireEvent.click(screen.getAllByText("Load")[0]);

    fireEvent.click(screen.getByText("1 · Prompt & Settings"));
    expect((screen.getByLabelText("Persona") as HTMLSelectElement).value).toBe("acl-comeback");
    expect((screen.getByLabelText("Point of view") as HTMLSelectElement).value).toBe("second-person");

    // Regenerating from a restored plan must author under the same persona.
    mockAuthor.mockClear();
    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));
    await waitFor(() => expect(mockAuthor).toHaveBeenCalled());
    expect(mockAuthor.mock.calls[0][0]).toContain("SECOND PERSON");
  });

  it("flags a generated line that fell back to a stock phrase", async () => {
    const mockAuthor = vi.fn().mockResolvedValue(
      JSON.stringify({
        title: "Generic One",
        hook: "H",
        beats: [{ scriptText: "They said I couldn't, so I did.", shotDescription: "y" }],
      })
    );
    renderWithProviders(<MotivationalStoryView author={mockAuthor} />);

    fireEvent.click(screen.getByText("⚡ Generate Story Plan"));
    await waitFor(() => expect(screen.getByText("Generic One")).toBeTruthy());
    expect(screen.getByText(/stock motivational phrase/i)).toBeTruthy();
  });
});
