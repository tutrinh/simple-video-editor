// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectProvider } from "../state/ProjectContext";
import ProjectManagerModal from "./ProjectManagerModal";

const storageMocks = vi.hoisted(() => ({
  listSavedProjects: vi.fn(),
  loadAllTemplates: vi.fn(),
}));

vi.mock("../lib/projectStorage", () => ({
  listSavedProjects: storageMocks.listSavedProjects,
  loadAllTemplates: storageMocks.loadAllTemplates,
  loadProjectFromStorage: vi.fn(),
  deleteProjectFromStorage: vi.fn(),
  deleteTemplate: vi.fn(),
}));

vi.mock("../state/ExportSettingsContext", () => ({
  useExportSettings: () => ({ reset: vi.fn() }),
}));

vi.mock("../lib/projectPackager", () => ({
  exportProjectFile: vi.fn(),
  importProjectFile: vi.fn(),
}));

vi.mock("./InspirationUploadModal", () => ({
  default: () => null,
}));

describe("ProjectManagerModal reel templates", () => {
  beforeEach(() => {
    storageMocks.listSavedProjects.mockResolvedValue([]);
    storageMocks.loadAllTemplates.mockResolvedValue([]);
  });

  it("shows the four built-in reel starters when storage has no custom templates", async () => {
    render(
      <ProjectProvider>
        <ProjectManagerModal isOpen onClose={vi.fn()} />
      </ProjectProvider>,
    );

    const templatesTab = await screen.findByRole("button", { name: "Templates (4)" });
    await userEvent.click(templatesTab);

    for (const name of [
      "Product Review Reel",
      "Lifestyle Vlog Reel",
      "Fashion Vlog Reel",
      "Motivation Vlog Reel",
    ]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getAllByText("Reel starter")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Use Template" })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    await waitFor(() => expect(storageMocks.loadAllTemplates).toHaveBeenCalledOnce());
  });
});
