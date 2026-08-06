import type { Veil, VeilDirection } from "../domain/types";
import { DEFAULT_VEIL } from "../features/cover/veil";
import ColorField from "./ColorField";
import SegmentedControl from "../design-system/SegmentedControl";
import RangeField from "../design-system/RangeField";
import Switch from "../design-system/Switch";

// The Veil editor. Both gradient stops stay mounted in solid mode's state even
// though only one is shown, so switching modes never discards a colour the
// author picked (see the Veil type).

const MODES = [
  { value: "solid" as const, label: "Solid" },
  { value: "linear" as const, label: "Gradient" },
];

const DIRECTIONS: { value: VeilDirection; label: string }[] = [
  { value: "down", label: "↓" },
  { value: "up", label: "↑" },
  { value: "right", label: "→" },
  { value: "left", label: "←" },
];

/** Opacity as a percentage, through the shared field (DESIGN_PATTERNS §2). */
function OpacityRow({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <RangeField
      label={label}
      value={Math.round(value * 100)}
      min={0}
      max={100}
      onChange={(n) => onChange(n / 100)}
      formatValue={(n) => `${n}%`}
    />
  );
}

interface Props {
  veil: Veil | undefined;
  onChange: (veil: Veil | undefined) => void;
}

export default function VeilEditor({ veil, onChange }: Props) {
  const on = !!veil;
  const v = veil ?? DEFAULT_VEIL;
  const patch = (next: Partial<Veil>) => onChange({ ...v, ...next });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>Veil</div>
          <div style={{ color: "var(--ink-3)", fontSize: 9, lineHeight: 1.4, marginTop: 2 }}>
            Dim the picture so the title reads. Sits under stickers and text.
          </div>
        </div>
        <Switch
          checked={on}
          label="Enable the Veil over this cover's picture"
          onChange={(next) => onChange(next ? DEFAULT_VEIL : undefined)}
        />
      </div>

      {on && (
        <>
          <SegmentedControl value={v.mode} options={MODES} onChange={(mode) => patch({ mode })} ariaLabel="Veil fill" />

          <ColorField
            value={v.color}
            onChange={(color) => patch({ color })}
            label={v.mode === "linear" ? "From" : "Colour"}
            noun="veil colour"
          />
          <OpacityRow
            label={v.mode === "linear" ? "From" : "Opacity"}
            value={v.opacity}
            onChange={(opacity) => patch({ opacity })}
          />

          {v.mode === "linear" && (
            <>
              <ColorField value={v.toColor} onChange={(toColor) => patch({ toColor })} label="To" noun="veil colour" />
              <OpacityRow label="To" value={v.toOpacity} onChange={(toOpacity) => patch({ toOpacity })} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Direction</span>
                <SegmentedControl
                  value={v.direction}
                  options={DIRECTIONS}
                  onChange={(direction) => patch({ direction })}
                  ariaLabel="Veil gradient direction"
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
