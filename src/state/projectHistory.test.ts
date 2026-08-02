import { describe, expect, it } from "vitest";
import { initialProjectHistory, projectHistoryReducer } from "./projectHistory";

describe("project history", () => {
  it("undoes and redoes project edits", () => {
    let history = initialProjectHistory();
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "SET_TITLE", title: "First" }, at: 100 });
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "SET_DIRECTION", direction: "Tense" }, at: 1000 });
    history = projectHistoryReducer(history, { kind: "undo" });
    expect(history.present).toMatchObject({ title: "First", direction: "" });
    history = projectHistoryReducer(history, { kind: "redo" });
    expect(history.present.direction).toBe("Tense");
  });

  it("coalesces rapid edits to the same control into one undo step", () => {
    let history = initialProjectHistory();
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "SET_TITLE", title: "A" }, at: 100 });
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "SET_TITLE", title: "AB" }, at: 200 });
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "SET_TITLE", title: "ABC" }, at: 300 });
    expect(history.past).toHaveLength(1);
    history = projectHistoryReducer(history, { kind: "undo" });
    expect(history.present.title).toBe("");
  });

  it("does not make async media metadata a user-visible history step", () => {
    const clip = { id: "c", name: "c.mp4", file: new File([], "c.mp4"), durationSec: 1, width: 10, height: 10 };
    let history = initialProjectHistory({ title: "", direction: "", clips: [clip] });
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "SET_POSTER", id: "c", poster: "data:image/png,x" }, at: 100 });
    expect(history.past).toHaveLength(0);
  });

  it("clears history when a project is loaded", () => {
    let history = initialProjectHistory();
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "SET_TITLE", title: "Old" }, at: 100 });
    history = projectHistoryReducer(history, { kind: "dispatch", action: { type: "LOAD_PROJECT", state: { title: "Loaded", clips: [], direction: "" } }, at: 200 });
    expect(history.past).toHaveLength(0);
    expect(history.present.title).toBe("Loaded");
  });
});
