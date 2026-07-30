// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectProvider, useProject } from "../state/ProjectContext";
import { SettingsProvider } from "../state/SettingsContext";
import type { ProductSource } from "../features/product-review/productSource";
import ProductReviewView from "./ProductReviewView";

function ProjectProbe() {
  const { state } = useProject();
  return (
    <output aria-label="project state">
      {state.cut?.beats.length ?? 0}|{state.cut?.aspect ?? "none"}|{state.productReview?.plan?.script.length ?? 0}
    </output>
  );
}

const source: ProductSource = {
  async import({ url }) {
    return {
      ok: true,
      brief: {
        source: { kind: "amazon", url, asin: "B0ABC12345" },
        title: "Trail Press",
        brand: "Northline",
        features: [{ id: "claim-1", text: "Stainless steel body", source: "listing" }],
      },
      warnings: [],
    };
  },
};

const aiJson = JSON.stringify({
  hook: "Hotel coffee is optional.",
  script: [{
    id: "line-1",
    text: "This stainless steel press replaces weak hotel coffee.",
    purpose: "hook",
    approxDurationSec: 4,
    evidence: [{ kind: "product-claim", claimId: "claim-1" }],
    shotId: "shot-1",
  }, {
    id: "line-2",
    text: "I would pack it again.",
    purpose: "verdict",
    approxDurationSec: 4,
    evidence: [{ kind: "creator-note", field: "verdict" }],
    shotId: "shot-2",
  }],
  shots: [{
    id: "shot-1",
    description: "Close product demonstration",
    capture: "demo",
    framing: "close-up",
    approxDurationSec: 4,
  }, {
    id: "shot-2",
    description: "Verdict to camera",
    capture: "talking-head",
    framing: "medium",
    approxDurationSec: 4,
  }],
});

describe("ProductReviewView", () => {
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
  });

  it("imports, verifies, generates, and applies a product review Cut", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <ProjectProvider>
          <ProductReviewView productSource={source} author={async () => aiJson} />
          <ProjectProbe />
        </ProjectProvider>
      </SettingsProvider>,
    );

    await user.type(screen.getByLabelText("Amazon product URL"), "https://www.amazon.com/dp/B0ABC12345");
    await user.click(screen.getByRole("button", { name: "Import details" }));

    expect(await screen.findByDisplayValue("Trail Press")).toBeTruthy();
    await user.type(screen.getByLabelText("Audience"), "travel vloggers");
    await user.type(screen.getByLabelText("Your verdict"), "I would pack it again.");
    await user.selectOptions(screen.getByLabelText("Disclosure"), "purchased");
    await user.click(screen.getByRole("button", { name: "Continue to generation" }));
    await user.click(screen.getByRole("button", { name: "Generate Review Plan" }));

    expect(await screen.findByText("Hotel coffee is optional.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Apply to Project" }));

    await waitFor(() => expect(screen.getByLabelText("project state").textContent).toBe("2|9:16|2"));
  });

  it("preserves verified inputs when generation fails", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <ProjectProvider>
          <ProductReviewView productSource={source} author={async () => { throw new Error("CLI unavailable"); }} />
        </ProjectProvider>
      </SettingsProvider>,
    );

    await user.type(screen.getByLabelText("Amazon product URL"), "https://www.amazon.com/dp/B0ABC12345");
    await user.click(screen.getByRole("button", { name: "Import details" }));
    await user.type(await screen.findByLabelText("Your verdict"), "Useful for trips");
    await user.click(screen.getByRole("button", { name: "Continue to generation" }));
    await user.click(screen.getByRole("button", { name: "Generate Review Plan" }));

    expect((await screen.findByRole("alert")).textContent).toContain("CLI unavailable");
    await user.click(screen.getByRole("button", { name: "Back to product details" }));
    expect((screen.getByLabelText("Your verdict") as HTMLInputElement).value).toBe("Useful for trips");
  });
});
