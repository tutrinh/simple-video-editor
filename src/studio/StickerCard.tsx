import type { CoverSticker } from "../domain/types";
import { stickerFileUrl } from "../lib/stickerLibrary";
import { sliderTrackStyle } from "./util";
import { InputControl } from "../design-system/ControlPrimitives";
import ColorField from "./ColorField";

/**
 * Everything about how a Sticker LOOKS, shared by the Inspector's Sticker card
 * and a Cover's (ADR-0021).
 *
 * Timing is deliberately outside: a Sticker on the Cut has a start, a length and
 * a "fit to beat", and a Sticker on a Cover has none of those because a Cover is
 * a still. That split is the same one `CoverSticker` makes at the type level and
 * `DrawableSticker` makes at the renderer — appearance travels, timing does not.
 *
 * Callers supply their own header and, if they have one, their own timing footer.
 */

/** The Sticker card's slider row — wider value column than DESIGN_PATTERNS §2's
 *  default, because these read as percentages and degrees. */
export function StickerRow({
  label, value, min, max, step, format, reset, ariaLabel, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  /** Double-clicking the slider returns it here. */
  reset: number;
  /** Accessible name, when the visible label alone would be ambiguous. */
  ariaLabel?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 11, width: 62, color: "var(--ink-2)" }}>{label}</span>
      <InputControl
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel ?? label}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(reset)}
        style={sliderTrackStyle(value, min, max)}
      />
      <span style={{ fontSize: 10, width: 42, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
        {format(value)}
      </span>
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

interface Props {
  sticker: CoverSticker;
  /** Called with just the changed fields. */
  onChange: (patch: Partial<CoverSticker>) => void;
}

export default function StickerAppearance({ sticker, onChange }: Props) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <img
          src={stickerFileUrl(sticker.fileName)}
          alt=""
          style={{ width: 40, height: 40, objectFit: "contain", background: "var(--panel-3)", borderRadius: 6, padding: 3, flexShrink: 0 }}
        />
        <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink)", wordBreak: "break-all", minWidth: 0 }}>
          {sticker.fileName}
        </div>
      </div>

      <StickerRow label="X" ariaLabel="Sticker x" value={sticker.x} min={0} max={1} step={0.005} format={pct} reset={0.5}
        onChange={(x) => onChange({ x })} />
      <StickerRow label="Y" ariaLabel="Sticker y" value={sticker.y} min={0} max={1} step={0.005} format={pct} reset={0.5}
        onChange={(y) => onChange({ y })} />
      <StickerRow label="Scale" ariaLabel="Sticker scale" value={sticker.scale} min={0.02} max={1.5} step={0.005} format={pct} reset={0.25}
        onChange={(scale) => onChange({ scale })} />
      <StickerRow label="Rotation" ariaLabel="Sticker rotation" value={sticker.rotation} min={-180} max={180} step={1} reset={0}
        format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}°`}
        onChange={(rotation) => onChange({ rotation })} />
      <StickerRow label="Opacity" ariaLabel="Sticker opacity" value={sticker.opacity} min={0} max={1} step={0.01} format={pct} reset={1}
        onChange={(opacity) => onChange({ opacity })} />

      {/* Tint — strength slider plus the same swatch + picker idiom the Title
          treatment uses. A hue rotation would be useless here: most sticker
          assets are monochrome icons, and rotating the hue of near-black does
          nothing. This lays a colour over the asset clipped to its alpha. */}
      <StickerRow label="Tint" ariaLabel="Sticker tint" value={sticker.tintStrength ?? 0} min={0} max={1} step={0.01} format={pct} reset={0}
        onChange={(tintStrength) => onChange({ tintStrength })} />
      {/* The shared palette (ADR-0013) — same swatches the Title row shows.
          Picking a colour still turns the tint on when it was off. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, marginLeft: 70 }}>
        <ColorField
          value={sticker.tintColor ?? "#ffffff"}
          onChange={(tintColor) => onChange({ tintColor, tintStrength: sticker.tintStrength || 1 })}
          label=""
          noun="tint"
        />
      </div>
    </>
  );
}
