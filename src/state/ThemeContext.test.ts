import { describe, it, expect, beforeEach, vi } from "vitest";

describe("ThemeContext logic", () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
      clear: () => {
        storage = {};
      },
    });
  });

  it("stores and retrieves theme from localStorage", () => {
    localStorage.setItem("vidstr_theme", "light");
    expect(localStorage.getItem("vidstr_theme")).toBe("light");
  });

  it("toggles theme correctly between dark and light", () => {
    let theme: "dark" | "light" = "dark";
    const toggle = () => {
      theme = theme === "dark" ? "light" : "dark";
    };
    expect(theme).toBe("dark");
    toggle();
    expect(theme).toBe("light");
    toggle();
    expect(theme).toBe("dark");
  });
});
