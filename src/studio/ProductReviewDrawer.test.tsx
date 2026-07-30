// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectProvider } from "../state/ProjectContext";
import { SettingsProvider } from "../state/SettingsContext";
import ProductReviewDrawer from "./ProductReviewDrawer";

it("renders as an accessible region and closes on Escape", async () => {
  const onClose = vi.fn();
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

  render(
    <SettingsProvider>
      <ProjectProvider>
        <ProductReviewDrawer open onClose={onClose} />
      </ProjectProvider>
    </SettingsProvider>,
  );
  expect(screen.getByRole("region", { name: "Product Review" })).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});
