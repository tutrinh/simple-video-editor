import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ProjectProvider } from "./state/ProjectContext";
import { SettingsProvider } from "./state/SettingsContext";
import { ExportSettingsProvider } from "./state/ExportSettingsContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <ProjectProvider>
        <ExportSettingsProvider>
          <App />
        </ExportSettingsProvider>
      </ProjectProvider>
    </SettingsProvider>
  </StrictMode>,
);
