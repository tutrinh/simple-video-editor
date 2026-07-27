import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("AI Story busy state", () => {
  const view = readFileSync(new URL("./AiStoryView.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./studio.css", import.meta.url), "utf8");
  const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

  it("announces work and exposes an indeterminate progressbar", () => {
    expect(view).toContain('role="status"');
    expect(view).toContain('aria-live="polite"');
    expect(view).toContain('role="progressbar"');
    expect(view).toContain("regen.label");
  });

  it("animates progress while respecting reduced-motion preferences", () => {
    expect(css).toContain("@keyframes st-ai-progress");
    expect(css).toContain("@keyframes st-ai-spin");
    expect(css).toContain("@media (prefers-reduced-motion:reduce)");
  });

  it("separates the Codex prompt from variadic image arguments", () => {
    expect(viteConfig).toContain('args.push("--", prompt)');
    expect(viteConfig).not.toContain("args.push(prompt);");
    expect(viteConfig).toContain("child.stdin?.end()");
  });
});
