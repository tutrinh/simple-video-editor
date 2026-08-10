import type { ColorAdjustments, ColorizeSettings } from "../domain/types";
import { InputControl } from "../design-system/ControlPrimitives";
import Button from "../design-system/Button";
import ColorizeControl from "./ColorizeControl";
import { sliderTrackStyle } from "./util";

interface Props {
  value?: ColorAdjustments;
  onChange: (next: ColorAdjustments) => void;
  onAutoRec709?: () => void;
}

const ROWS: Array<{ key: Exclude<keyof ColorAdjustments, "colorize">; label: string; section?: string }> = [
  { key: "exposure", label: "Exposure" },
  { key: "contrast", label: "Contrast" },
  { key: "colorTone", label: "Hue" },
  { key: "warmth", label: "Warmth" },
  { key: "tint", label: "Tint" },
  { key: "saturation", label: "Saturation" },
  { key: "shadows", label: "Shadows", section: "Tone" },
  { key: "blackPoint", label: "Black point" },
  { key: "highlights", label: "Highlights" },
  { key: "skinTone", label: "Orange / Skin", section: "Split tone" },
  { key: "shadowWarmth", label: "Shadow warm" },
  { key: "shadowTint", label: "Shadow tint" },
  { key: "highlightWarmth", label: "Highlt warm" },
  { key: "highlightTint", label: "Highlt tint" },
];

export function hasColorAdjustments(value?: ColorAdjustments): boolean {
  if (!value) return false;
  return ROWS.some(({ key }) => (value[key] ?? 0) !== 0) || (value.colorize?.intensity ?? 0) > 0;
}

/** The shared Beat/overlay grade editor. Rendering stays identical for both owners. */
export default function ColorAdjustmentsControl({ value = {}, onChange, onAutoRec709 }: Props) {
  const set = (key: keyof ColorAdjustments, next: number | ColorizeSettings) => onChange({ ...value, [key]: next });
  return (
    <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ColorizeControl value={value.colorize} onChange={(colorize) => set("colorize", colorize)} />
      {onAutoRec709 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--ink)", fontSize: 11, fontWeight: 650 }}>Flat footage?</div>
            <div style={{ color: "var(--ink-3)", fontSize: 9, lineHeight: 1.4, marginTop: 2 }}>Add a neutral Rec.709-style normalization.</div>
          </div>
          <Button variant="secondary" size="small" onClick={onAutoRec709} style={{ flex: "none" }}>Auto Rec.709</Button>
        </div>
      )}
      {ROWS.map(({ key, label, section }) => {
        const current = value[key] ?? 0;
        return (
          <div key={key}>
            {section && <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", margin: "2px 0 7px" }}>{section}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>{label}</span>
              <InputControl
                type="range"
                min={-100}
                max={100}
                value={current}
                aria-label={label}
                onChange={(event) => set(key, Number(event.target.value))}
                onDoubleClick={() => set(key, 0)}
                title="Drag to adjust, double-click to reset to 0"
                style={sliderTrackStyle(current, -100, 100)}
              />
              <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                {current > 0 ? `+${current}` : current}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
