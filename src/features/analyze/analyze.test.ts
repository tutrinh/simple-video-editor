import { describe, it, expect } from "vitest";
import { hintFromName } from "./analyze";

describe("hintFromName", () => {
  it("strips the extension, keeping the human label", () => {
    expect(hintFromName("2026 LSC OKC 30fps Evey Kill 01.mp4")).toBe("2026 LSC OKC 30fps Evey Kill 01");
    expect(hintFromName("The Win.mov")).toBe("The Win");
  });
  it("leaves extensionless names alone", () => {
    expect(hintFromName("clip")).toBe("clip");
  });
});
