import { useEffect, useState } from "react";
import { loadPalette, addPaletteColor, removePaletteColor, subscribePalette, normalizeHex } from "../lib/colorPalette";
import ColorControl from "../design-system/ColorControl";
import { ControlButton } from "../design-system/ControlPrimitives";
import EyedropperIcon from "../design-system/icons/EyedropperIcon";

// The one colour control (ADR-0013). Presentational: it takes value/onChange and
// does not know whether it is colouring a Title layer or a Sticker tint, so the
// next thing that needs a colour gets the shared palette for free.

/** Live view of the shared palette — every mounted field updates together. */
function usePalette(): string[] {
  const [colors, setColors] = useState<string[]>(() => loadPalette());
  useEffect(() => subscribePalette(setColors), []);
  return colors;
}

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

/** Chromium-only. Absent elsewhere, where the native color input still carries the OS picker. */
function eyeDropper(): EyeDropperCtor | null {
  const C = (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof C === "function" ? C : null;
}

interface Props {
  /** Current colour, any hex form. */
  value: string;
  onChange: (hex: string) => void;
  /** Row label; omit for no label. */
  label?: string;
  /** Noun for the tooltips ("tint", "text"). */
  noun?: string;
}

export default function ColorField({ value, onChange, label = "Color", noun = "colour" }: Props) {
  const palette = usePalette();
  const current = normalizeHex(value) ?? "#ffffff";
  const ED = eyeDropper();

  // Anything picked by hand joins the palette — a colour worth sampling is a
  // colour worth reusing, which is the whole point of the shared palette.
  const pick = (hex: string) => {
    const norm = normalizeHex(hex);
    if (!norm) return;
    addPaletteColor(norm);
    onChange(norm);
  };

  const sample = async () => {
    if (!ED) return;
    try {
      const { sRGBHex } = await new ED().open();
      pick(sRGBHex);
    } catch {
      /* the user dismissed the eyedropper */
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {label && <span>{label}</span>}

      {palette.map((hex) => (
        <ControlButton
          key={hex}
          type="button"
          onClick={() => onChange(hex)}
          onContextMenu={(e) => { e.preventDefault(); removePaletteColor(hex); }}
          title={`${hex} — right-click to remove from the palette`}
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: hex,
            border: current === hex ? "2px solid var(--accent)" : "1px solid var(--line)",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}

      <ColorControl
        value={current}
        onChange={(e) => pick(e.target.value)}
        title={`Custom ${noun} — joins the palette`}
      />

      {ED && (
        <ControlButton
          type="button"
          onClick={sample}
          title={`Pick a ${noun} from anywhere on screen — joins the palette`}
          style={{
            width: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "1px solid var(--line)",
            background: "var(--panel-3)",
            color: "var(--ink-2)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <EyedropperIcon size={12} />
        </ControlButton>
      )}
    </span>
  );
}
