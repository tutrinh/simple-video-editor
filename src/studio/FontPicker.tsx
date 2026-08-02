import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import {
  GOOGLE_TITLE_FONTS, SYSTEM_TITLE_FONTS, ensureGoogleFontLoaded,
  googleFamilyId, parseGoogleFamilyId, syntheticGoogleFont, probeGoogleFamily, findFontById,
} from "../lib/googleFonts";
import { appFontCssFamily, appFontId, ensureAppFontLoaded, fetchFontList, uploadFont } from "../lib/fontLibrary";
import { useSettings } from "../state/SettingsContext";

// A font list that shows each face in its own typeface. A native select cannot
// do this because browsers do not reliably honour font-family on each option, so this is
// a custom listbox rather than a styled select.

const CUSTOM_ID = "custom";

/** The group header already says "Google Fonts"; the suffix is noise in the row. */
function displayName(name: string): string {
  return name.replace(/\s*\(Google Font\)$/i, "");
}

interface Props {
  /** Font id, or "custom" for an uploaded face. */
  value: string;
  onChange: (fontId: string) => void;
}

const MAX_LIST_H = 280;

export default function FontPicker({ value, onChange }: Props) {
  const { settings } = useSettings();
  const savedGoogleFonts = settings.customGoogleFonts.map(syntheticGoogleFont);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const [probing, setProbing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [appFonts, setAppFonts] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // The list is rendered in a PORTAL with fixed coordinates rather than
  // absolutely inside the row. Both call sites live in `overflow: auto` panels
  // (`.st-insp-body`, and Export's scroll body), which would clip a dropdown
  // this tall at the panel edge. Re-measure on any ancestor scroll — the
  // capture phase is what catches those, since scroll does not bubble.
  useEffect(() => {
    if (!open) return;
    const place = () => setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // The previews ARE the feature, so every Google face has to be in the document
  // before the list is shown. The editor otherwise loads only the fonts that
  // enabled layers actually use, and unloaded rows would all render identically
  // in the fallback — exactly the problem this component exists to solve.
  useEffect(() => {
    if (open) {
      [...GOOGLE_TITLE_FONTS, ...savedGoogleFonts].forEach(ensureGoogleFontLoaded);
      appFonts.forEach(ensureAppFontLoaded);
      void fetchFontList().then((files) => {
        setAppFonts(files);
        files.forEach(ensureAppFontLoaded);
      });
    }
  }, [open, settings.customGoogleFonts]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // The list is portalled out of the row, so "outside" has to mean outside
      // BOTH the trigger and the popup.
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popupRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A family typed by name (ADR-0014) is not in either list — synthesise it so
  // the trigger previews it and it shows as the checked row.
  const typedFamily = parseGoogleFamilyId(value);
  const current = typedFamily ? syntheticGoogleFont(typedFamily) : findFontById(value);
  const label = value === CUSTOM_ID ? "Legacy embedded font" : displayName(current?.name ?? "Select a font…");

  const importFont = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError("");
    try {
      const name = await uploadFont(file);
      setAppFonts((files) => [...new Set([...files, name])].sort());
      ensureAppFontLoaded(name);
      onChange(appFontId(name));
      setOpen(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  const commitFamily = async () => {
    const family = query.trim();
    if (!family || probing) return;
    setProbing(true);
    setNotFound(false);
    const ok = await probeGoogleFamily(family);
    setProbing(false);
    if (!ok) { setNotFound(true); return; }
    // Load the stylesheet before closing so the preview restyles immediately.
    ensureGoogleFontLoaded(syntheticGoogleFont(family));
    onChange(googleFamilyId(family));
    setQuery("");
    setOpen(false);
  };

  const groupHeader = (text: string) => (
    <div style={{ padding: "6px 10px 3px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-3)" }}>
      {text}
    </div>
  );

  const row = (id: string, name: string, cssFamily?: string) => {
    const on = id === value;
    return (
      <ControlButton
        key={id}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => { onChange(id); setOpen(false); }}
        title={name}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          textAlign: "left",
          padding: "6px 10px",
          border: "none",
          background: on ? "rgba(255, 179, 57, 0.15)" : "transparent",
          color: on ? "var(--accent)" : "var(--ink)",
          fontFamily: cssFamily ?? "inherit",
          fontSize: 15,
          lineHeight: 1.4,
          cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {on && <span style={{ fontFamily: "inherit", fontSize: 11 }}>✓</span>}
      </ControlButton>
    );
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <ControlButton
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose a font"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 150,
          background: "var(--panel-3)",
          border: open ? "1px solid var(--accent)" : "1px solid var(--line)",
          borderRadius: 6,
          color: "var(--ink)",
          fontSize: 13,
          // The trigger previews the current face too, so the chosen font is
          // legible without opening the list.
          fontFamily: value === CUSTOM_ID ? "inherit" : current?.cssFamily ?? "inherit",
          padding: "4px 8px",
          outline: "none",
          cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontFamily: "inherit", fontSize: 9, color: "var(--ink-3)" }}>▼</span>
      </ControlButton>

      {open && rect && createPortal(
        (() => {
          // Open downward unless the room below is too small to be useful and
          // there is more of it above.
          const below = window.innerHeight - rect.bottom - 8;
          const above = rect.top - 8;
          const flip = below < 180 && above > below;
          return (
            <div
              ref={popupRef}
              role="listbox"
              style={{
                position: "fixed",
                left: Math.min(rect.left, window.innerWidth - 236),
                ...(flip
                  ? { bottom: window.innerHeight - rect.top + 4 }
                  : { top: rect.bottom + 4 }),
                zIndex: 200,
                minWidth: 220,
                maxHeight: Math.min(MAX_LIST_H, Math.max(140, flip ? above : below)),
                overflowY: "auto",
                background: "var(--panel-2, var(--panel-3))",
                border: "1px solid var(--line)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                padding: "4px 0",
              }}
            >
              {/* A family already chosen by name sits at the top so the current
                  choice is visible — it is in neither list below. */}
              {typedFamily && (
                <>
                  {groupHeader("Current")}
                  {row(value, typedFamily, current?.cssFamily)}
                </>
              )}
              {savedGoogleFonts.length > 0 && (
                <>
                  {groupHeader("Saved Google Fonts")}
                  {savedGoogleFonts.map((f) => row(f.id, f.name, f.cssFamily))}
                </>
              )}
              {appFonts.length > 0 && (
                <>
                  {groupHeader("App fonts")}
                  {appFonts.map((file) => row(appFontId(file), file.replace(/\.[^.]+$/, ""), appFontCssFamily(file)))}
                </>
              )}
              {groupHeader("Google Fonts")}
              {GOOGLE_TITLE_FONTS.map((f) => row(f.id, displayName(f.name), f.cssFamily))}
              {groupHeader("System Fonts")}
              {SYSTEM_TITLE_FONTS.map((f) => row(f.id, f.name, f.cssFamily))}

              <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />
              {groupHeader("Any Google font by name")}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 10px 8px" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <InputControl
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setNotFound(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitFamily(); } }}
                    placeholder="e.g. Anton"
                    disabled={probing}
                    style={{ flex: 1, minWidth: 0, padding: "5px 8px", fontSize: 12, background: "var(--panel-3)", border: `1px solid ${notFound ? "var(--danger)" : "var(--line)"}`, borderRadius: 6, color: "var(--ink)", outline: "none" }}
                  />
                  <ControlButton
                    type="button"
                    onClick={commitFamily}
                    disabled={probing || !query.trim()}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel-3)", color: "var(--ink-2)", cursor: probing || !query.trim() ? "default" : "pointer" }}
                  >
                    {probing ? "…" : "Use"}
                  </ControlButton>
                </div>
                <div style={{ fontSize: 10, color: notFound ? "var(--danger)" : "var(--ink-3)", lineHeight: 1.4 }}>
                  {notFound
                    ? `No Google font called "${query.trim()}". Check the spelling on fonts.google.com.`
                    : "Fetched from Google Fonts. Needs network at export time."}
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />
              {groupHeader("App font library")}
              <label style={{ display: "block", margin: "2px 10px 6px", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink-2)", fontSize: 11, textAlign: "center", cursor: uploading ? "default" : "pointer" }}>
                {uploading ? "Importing…" : "Import .ttf or .otf"}
                <InputControl
                  type="file"
                  accept=".ttf,.otf,font/ttf,font/otf"
                  disabled={uploading}
                  onChange={(e) => { void importFont(e.target.files?.[0]); e.currentTarget.value = ""; }}
                  style={{ display: "none" }}
                />
              </label>
              {uploadError && <div style={{ padding: "0 10px 6px", color: "var(--danger)", fontSize: 10 }}>{uploadError}</div>}
              <div style={{ padding: "0 10px 7px", color: "var(--ink-3)", fontSize: 10, lineHeight: 1.4 }}>
                Imported once into the app's fonts directory and available to every project.
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
