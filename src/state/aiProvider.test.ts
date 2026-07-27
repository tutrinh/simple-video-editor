import { describe, expect, it } from "vitest";
import { AI_PROVIDER_OPTIONS, normalizeAiProvider } from "./SettingsContext";
import { aiEndpoint } from "../lib/claudeClient";

describe("AI providers", () => {
  it("offers only Claude CLI and Codex CLI", () => {
    expect(AI_PROVIDER_OPTIONS.map((option) => option.id)).toEqual(["claude", "codex"]);
  });

  it("routes each supported provider to its local proxy", () => {
    expect(aiEndpoint("claude")).toBe("/api/claude");
    expect(aiEndpoint("codex")).toBe("/api/codex");
    expect(aiEndpoint()).toBe("/api/claude");
  });

  it("migrates removed and unknown persisted providers back to Claude", () => {
    expect(normalizeAiProvider("antigravity")).toBe("claude");
    expect(normalizeAiProvider("unknown")).toBe("claude");
    expect(normalizeAiProvider("codex")).toBe("codex");
  });
});
