// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  // Vitest runs without `globals: true` here, so Testing Library's automatic cleanup
  // never registers and renders would otherwise pile up in one document.
  afterEach(() => {
    cleanup();
  });

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

    await user.type(screen.getByLabelText(/Product URL/i), "https://www.amazon.com/dp/B0ABC12345");
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

  it("accepts spaces and newlines while typing pros and cons", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <ProjectProvider>
          <ProductReviewView productSource={source} author={async () => aiJson} />
        </ProjectProvider>
      </SettingsProvider>,
    );

    await user.type(screen.getByLabelText(/Product URL/i), "https://www.amazon.com/dp/B0ABC12345");
    await user.click(screen.getByRole("button", { name: "Import details" }));
    await screen.findByDisplayValue("Trail Press");

    // The array-backed value used to be re-normalized on every keystroke, so the
    // trailing space and newline were swallowed and this came out "FirstlineSecondline".
    const pros = screen.getByLabelText("Pros (one per line)") as HTMLTextAreaElement;
    await user.type(pros, "Brews in four minutes\nNo paper filters");
    expect(pros.value).toBe("Brews in four minutes\nNo paper filters");

    const cons = screen.getByLabelText("Cons (one per line)") as HTMLTextAreaElement;
    await user.type(cons, "Plunger sticks when cold");
    expect(cons.value).toBe("Plunger sticks when cold");
  });

  it("recaps every verified feature, pro and con on the Generate step", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <ProjectProvider>
          <ProductReviewView productSource={source} author={async () => aiJson} />
        </ProjectProvider>
      </SettingsProvider>,
    );

    await user.type(screen.getByLabelText(/Product URL/i), "https://www.amazon.com/dp/B0ABC12345");
    await user.click(screen.getByRole("button", { name: "Import details" }));
    await screen.findByDisplayValue("Trail Press");

    const features = screen.getByLabelText("Product features (one per line)");
    await user.clear(features);
    await user.type(features, "Stainless steel body\nDouble-wall vacuum seal\nFits a 20oz bottle cage");

    await user.type(
      screen.getByLabelText("Pros (one per line)"),
      "Brews in four minutes\nNo paper filters\nSurvived a checked bag"
    );
    await user.type(
      screen.getByLabelText("Cons (one per line)"),
      "Plunger sticks when cold\nPricey for the size"
    );

    await user.click(screen.getByRole("button", { name: "Continue to generation" }));

    // Every item must be visible on step 2 — not a count, and nothing truncated.
    for (const item of [
      "Stainless steel body",
      "Double-wall vacuum seal",
      "Fits a 20oz bottle cage",
      "Brews in four minutes",
      "No paper filters",
      "Survived a checked bag",
      "Plunger sticks when cold",
      "Pricey for the size",
    ]) {
      expect(screen.getByText(item)).toBeTruthy();
    }

    expect(screen.getByText("What the script will be built from")).toBeTruthy();
  });

  it("tells the creator when pros or cons are still empty on the Generate step", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <ProjectProvider>
          <ProductReviewView productSource={source} author={async () => aiJson} />
        </ProjectProvider>
      </SettingsProvider>,
    );

    await user.type(screen.getByLabelText(/Product URL/i), "https://www.amazon.com/dp/B0ABC12345");
    await user.click(screen.getByRole("button", { name: "Import details" }));
    await screen.findByDisplayValue("Trail Press");
    await user.click(screen.getByRole("button", { name: "Continue to generation" }));

    expect(screen.getByText("No pros recorded yet.")).toBeTruthy();
    expect(screen.getByText(/a review with no cons reads like an ad/i)).toBeTruthy();
    // The imported listing claim still shows through.
    expect(screen.getByText("Stainless steel body")).toBeTruthy();
  });

  it("returns to step 1 from the Generate step recap", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <ProjectProvider>
          <ProductReviewView productSource={source} author={async () => aiJson} />
        </ProjectProvider>
      </SettingsProvider>,
    );

    await user.type(screen.getByLabelText(/Product URL/i), "https://www.amazon.com/dp/B0ABC12345");
    await user.click(screen.getByRole("button", { name: "Import details" }));
    await screen.findByDisplayValue("Trail Press");
    await user.click(screen.getByRole("button", { name: "Continue to generation" }));

    await user.click(screen.getByRole("button", { name: "Edit in step 1" }));
    expect(screen.getByLabelText("Product features (one per line)")).toBeTruthy();
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

    await user.type(screen.getByLabelText(/Product URL/i), "https://www.amazon.com/dp/B0ABC12345");
    await user.click(screen.getByRole("button", { name: "Import details" }));
    await user.type(await screen.findByLabelText("Your verdict"), "Useful for trips");
    await user.click(screen.getByRole("button", { name: "Continue to generation" }));
    await user.click(screen.getByRole("button", { name: "Generate Review Plan" }));

    expect((await screen.findByRole("alert")).textContent).toContain("CLI unavailable");
    await user.click(screen.getByRole("button", { name: "Back to product details" }));
    expect((screen.getByLabelText("Your verdict") as HTMLInputElement).value).toBe("Useful for trips");
  });
});
