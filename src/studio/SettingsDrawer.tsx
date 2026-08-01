import { useEffect, useState } from "react";
import Drawer from "../design-system/Drawer";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import {
  ensureGoogleFontLoaded,
  GOOGLE_TITLE_FONTS,
  parseGoogleFontUrl,
  probeGoogleFamily,
  syntheticGoogleFont,
} from "../lib/googleFonts";
import { useSettings } from "../state/SettingsContext";

/**
 * Slide-over side panel for workspace settings. Mounted only while open.
 * AI options (engine, model, tone, script type) now live in the AI Director drawer.
 */
export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings();
  const [fontUrl, setFontUrl] = useState("");
  const [fontError, setFontError] = useState("");
  const [fontNotice, setFontNotice] = useState("");
  const [addingFont, setAddingFont] = useState(false);

  useEffect(() => {
    if (!open) return;
    settings.customGoogleFonts
      .map(syntheticGoogleFont)
      .forEach(ensureGoogleFontLoaded);
  }, [open, settings.customGoogleFonts]);

  async function addGoogleFont() {
    const family = parseGoogleFontUrl(fontUrl);
    setFontError("");
    setFontNotice("");

    if (!family) {
      setFontError("Paste a Google Fonts specimen URL, such as https://fonts.google.com/specimen/Darumadrop+One.");
      return;
    }

    const builtIn = GOOGLE_TITLE_FONTS.some((font) =>
      font.name.replace(/\s*\(Google Font\)$/i, "").toLocaleLowerCase() === family.toLocaleLowerCase()
    );
    if (builtIn) {
      setFontNotice(`${family} is already included in the Title font picker.`);
      return;
    }

    const alreadySaved = settings.customGoogleFonts.some(
      (saved) => saved.toLocaleLowerCase() === family.toLocaleLowerCase(),
    );
    if (alreadySaved) {
      setFontNotice(`${family} is already in your font library.`);
      return;
    }

    setAddingFont(true);
    const available = await probeGoogleFamily(family);
    setAddingFont(false);
    if (!available) {
      setFontError(`Could not validate “${family}”. Check the URL and your network connection.`);
      return;
    }

    ensureGoogleFontLoaded(syntheticGoogleFont(family));
    update({ customGoogleFonts: [...settings.customGoogleFonts, family] });
    setFontUrl("");
    setFontNotice(`${family} was added to the Title font picker.`);
  }

  function removeGoogleFont(family: string) {
    update({
      customGoogleFonts: settings.customGoogleFonts.filter((saved) => saved !== family),
    });
    setFontNotice(`${family} was removed from your saved font library.`);
    setFontError("");
  }

  return (
    <Drawer open={open} title="Settings" onClose={onClose} side="left" bodyClassName="st-settings-body">
          <section className="st-settings-section" aria-labelledby="google-fonts-setting">
            <div className="st-setting-text">
              <div id="google-fonts-setting" className="st-setting-name">Google Fonts</div>
              <div className="st-setting-desc">
                Paste a specimen URL. Imported families are saved on this device and appear in every Title font picker. Network is required when first loading or exporting the face.
              </div>
            </div>

            <div className="st-settings-font-import">
              <InputControl
                type="url"
                value={fontUrl}
                onChange={(event) => {
                  setFontUrl(event.target.value);
                  setFontError("");
                  setFontNotice("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addGoogleFont();
                  }
                }}
                placeholder="https://fonts.google.com/specimen/…"
                aria-label="Google Fonts specimen URL"
                disabled={addingFont}
              />
              <ControlButton
                type="button"
                onClick={() => void addGoogleFont()}
                disabled={addingFont || !fontUrl.trim()}
              >
                {addingFont ? "Checking…" : "Add font"}
              </ControlButton>
            </div>

            {(fontError || fontNotice) && (
              <div
                className={`st-settings-font-feedback ${fontError ? "error" : "success"}`}
                role={fontError ? "alert" : "status"}
              >
                {fontError || fontNotice}
              </div>
            )}

            {settings.customGoogleFonts.length > 0 ? (
              <div className="st-settings-font-list" aria-label="Saved Google Fonts">
                {settings.customGoogleFonts.map((family) => (
                  <div className="st-settings-font-item" key={family}>
                    <span style={{ fontFamily: syntheticGoogleFont(family).cssFamily }}>{family}</span>
                    <ControlButton
                      type="button"
                      onClick={() => removeGoogleFont(family)}
                      aria-label={`Remove ${family}`}
                      title={`Remove ${family} from the saved font library`}
                    >
                      Remove
                    </ControlButton>
                  </div>
                ))}
              </div>
            ) : (
              <div className="st-settings-font-empty">No imported Google Fonts yet.</div>
            )}
          </section>

          <div className="st-setting-row">
            <div className="st-setting-text">
              <div className="st-setting-name">Design system</div>
              <div className="st-setting-desc">
                Browse foundations, controls, feedback states, and editor patterns.
              </div>
            </div>
            <a className="st-settings-link" href="/design-system">
              View system
              <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="st-setting-row">
            <div className="st-setting-text">
              <div className="st-setting-name">AI options moved</div>
              <div className="st-setting-desc">
                Engine, model, tone, and script type now live in AI Director (top bar).
              </div>
            </div>
          </div>
    </Drawer>
  );
}
