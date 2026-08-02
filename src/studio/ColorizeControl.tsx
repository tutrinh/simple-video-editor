import type { ColorizeSettings } from "../domain/types";
import { COLORIZE_PRESETS, DEFAULT_COLORIZE, normalizeColorize } from "../lib/colorize";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import Switch from "../design-system/Switch";
import ColorField from "./ColorField";
import { sliderTrackStyle } from "./util";

interface Props {
  value?: ColorizeSettings;
  onChange: (value: ColorizeSettings) => void;
  /** Preset value used by double-click reset in the global editor. */
  baseValue?: ColorizeSettings;
}

/** Shared creative colour-wash editor used by Beat and Global grades. */
export default function ColorizeControl({ value, onChange, baseValue }: Props) {
  const current = normalizeColorize(value);
  const enabled = current.intensity > 0;
  const update = (patch: Partial<ColorizeSettings>) => onChange({ ...current, ...patch });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ color: "var(--ink)", fontSize: 11, fontWeight: 650 }}>Colorize</div>
          <div style={{ color: "var(--ink-3)", fontSize: 9, lineHeight: 1.4, marginTop: 2 }}>Wash shadows and highlights with a creative palette.</div>
        </div>
        <Switch
          checked={enabled}
          onChange={(next) => update({ intensity: next ? (baseValue?.intensity || value?.intensity || DEFAULT_COLORIZE.intensity) : 0 })}
          label="Enable creative Colorize wash"
        />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {COLORIZE_PRESETS.map((preset) => (
          <ControlButton
            key={preset.name}
            type="button"
            className="st-btn ghost"
            onClick={() => onChange({ ...preset.value })}
            style={{ fontSize: 9, padding: "3px 7px" }}
            title={`Apply the ${preset.name} Colorize palette`}
          >
            {preset.name}
          </ControlButton>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, width: 70, flex: "0 0 70px", color: "var(--ink-2)" }}>Shadows</span>
        <ColorField value={current.shadowColor} onChange={(shadowColor) => update({ shadowColor })} label="" noun="shadow Colorize colour" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, width: 70, flex: "0 0 70px", color: "var(--ink-2)" }}>Highlights</span>
        <ColorField value={current.highlightColor} onChange={(highlightColor) => update({ highlightColor })} label="" noun="highlight Colorize colour" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Intensity</span>
        <InputControl
          type="range"
          min={0}
          max={100}
          value={current.intensity}
          onChange={(e) => update({ intensity: Number(e.target.value) })}
          onDoubleClick={() => update({ intensity: baseValue?.intensity ?? 0 })}
          title={`Drag to adjust, double-click to reset to ${baseValue?.intensity ?? 0}`}
          style={sliderTrackStyle(current.intensity, 0, 100)}
        />
        <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(current.intensity)}%</span>
      </div>
    </div>
  );
}
