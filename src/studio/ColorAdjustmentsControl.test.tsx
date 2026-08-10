// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ColorAdjustmentsControl from "./ColorAdjustmentsControl";

afterEach(cleanup);

describe("ColorAdjustmentsControl", () => {
  it("edits the same adjustment object for any video owner", () => {
    const onChange = vi.fn();
    render(<ColorAdjustmentsControl value={{ contrast: 10 }} onChange={onChange} />);
    const exposure = screen.getByRole("slider", { name: "Exposure" });
    fireEvent.change(exposure, { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith({ contrast: 10, exposure: 25 });
  });
});
