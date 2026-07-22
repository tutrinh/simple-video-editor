import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ProjectProvider } from "./state/ProjectContext";
import { SettingsProvider } from "./state/SettingsContext";
import { ExportSettingsProvider } from "./state/ExportSettingsContext";
import { ThemeProvider } from "./state/ThemeContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <ProjectProvider>
          <ExportSettingsProvider>
            <App />
          </ExportSettingsProvider>
        </ProjectProvider>
      </SettingsProvider>
    </ThemeProvider>
  </StrictMode>,
);
