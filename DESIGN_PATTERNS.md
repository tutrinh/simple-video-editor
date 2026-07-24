# 🎨 Simple Video Editor — UI Design System & Governance Guide

This document establishes the official Design System governance for the **Simple Video Editor** workspace. All developers and AI agents **MUST** follow these tokens, rules, and component patterns when creating or modifying UI elements to prevent design drift.

---

## 1. Design Tokens & Theme Architecture

The application supports seamless **Dark Mode** (default) and **Light Mode** switching using CSS custom properties defined in `src/studio/studio.css`. **Never hardcode arbitrary hex/RGB colors or native browser defaults** (e.g. native `#0075ff` blue).

### Core Token Reference

| CSS Token | Dark Theme (Default) | Light Theme | Usage Description |
| :--- | :--- | :--- | :--- |
| `--bg` | `#0d0e11` | `#f3f4f8` | Primary background canvas |
| `--panel` | `#15171c` | `#ffffff` | Primary panel container background |
| `--panel-2` | `#1b1e24` | `#edf0f6` | Secondary panel / card background |
| `--panel-3` | `#22262e` | `#e0e5ef` | Tertiary background / slider unfilled track |
| `--line` | `#282c34` | `#d2d7e2` | Standard borders & dividers |
| `--line-soft` | `#20242b` | `#e4e8f1` | Subtle container borders |
| `--ink` | `#e8e9ec` | `#11141a` | High-contrast primary text |
| `--ink-2` | `#9aa0ab` | `#485060` | Secondary labels & subtext |
| `--ink-3` | `#6b7180` | `#727b8c` | Muted timestamps & meta info |
| `--accent` | `#ffb339` (Amber) | `#b84c00` (Warm Terracotta) | Primary active state & brand accent |
| `--accent-hover`| `#ffbe57` | `#9e3f00` | Hover state for primary buttons/accents |
| `--accent-ink` | `#1a1206` | `#ffffff` | High-contrast text rendered over accent |
| `--good` | `#57c98a` | `#138344` | Success / active state badges |
| `--danger` | `#e5695f` | `#c92a20` | Destructive action buttons & alerts |

---

## 2. Form Controls Governance

### Range Sliders (`input[type="range"]`)
- **Rule**: ALL range sliders must consume `var(--accent)` for the active progress fill and thumb, and `var(--panel-3)` for the unfilled track background.
- **Track Height**: `6px` (`border-radius: 3px`).
- **Thumb Size**: `15px` diameter, `2px solid var(--panel)` border, with smooth hover scale (`transform: scale(1.2)`).
- **CSS Class**: Use `.st-range` or inline helper `sliderTrackStyle(val, min, max)`:

```ts
// src/studio/Inspector.tsx
function sliderTrackStyle(val: number, min = 0, max = 1): React.CSSProperties {
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  return {
    flex: 1,
    width: "100%",
    accentColor: "var(--accent)",
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--panel-3) ${pct}%, var(--panel-3) 100%)`,
    height: 6,
    borderRadius: 3,
  };
}
```

### Compact Slider Row (name · slider · value)

- **Rule**: Any group of labeled range sliders (color adjustments, fine-tune filters, etc.) **MUST** use the compact single-row layout — **never** stack the label/value on a separate line above the track.
- **Structure**: a flex row (`display: flex; align-items: center; gap: 8`) with exactly three columns:
  1. **Name** — `<span>`, `fontSize: 11`, **`width: 70`** (fixed), `color: var(--ink-2)`.
  2. **Slider** — `<input type="range">` styled via `sliderTrackStyle(...)` (flexes to fill).
  3. **Value** — `<span>`, `fontSize: 10`, **`width: 32`**, `textAlign: "right"`, `color: var(--ink-3)`, `fontVariantNumeric: "tabular-nums"`. Prefix positive values with `+` (e.g. `+22`).
- **Container**: wrap the rows in `.st-color-adjustments` with `display: flex; flexDirection: column; gap: 8`.

```tsx
<div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Exposure</span>
    <input type="range" min="-100" max="100" value={val}
      onChange={(e) => update("exposure", Number(e.target.value))}
      style={sliderTrackStyle(val, -100, 100)} />
    <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
      {val > 0 ? `+${val}` : val}
    </span>
  </div>
  {/* …one row per adjustment… */}
</div>
```

### Toggle Switch (`<Switch>`)

- **Rule**: All on/off toggles **MUST** use the reusable `Switch` component (`src/studio/Switch.tsx`) — do not hand-roll checkboxes or inline switch markup.
- **API**: `<Switch checked={bool} onChange={(next) => …} label="Accessible label" disabled?={bool} />`. It renders an accessible `role="switch"` button.
- **Styling** (`.st-switch` in `studio.css`): `42×24` pill, `--panel-3` track with a soft `color-mix(in srgb, var(--ink-3) 25%, transparent)` border (deepening to `--ink-2` on hover), `--accent` fill + border when on, white `18px` knob that slides right.
- **Specificity note**: switch rules are prefixed with `.studio` (e.g. `.studio .st-switch`) so they win over the global `.studio button { border:none; background:none }` reset — keep that prefix on any new switch styles.

---

## 3. Buttons & Interactive States

Always use standard button style classes defined in `studio.css`:

```html
<!-- Primary Action -->
<button className="st-btn primary">Save Changes</button>

<!-- Ghost / Secondary Action -->
<button className="st-btn ghost">Cancel</button>

<!-- Destructive Action -->
<button className="st-btn danger">Remove</button>
```

### Pointer Event Propagation in Draggable Containers
- **CRITICAL RULE**: When embedding action buttons (`✕` remove, reorder handles, dropdown toggles) inside draggable items (e.g. timeline beat cards, overlay track pills), **ALWAYS add `onPointerDown={(e) => e.stopPropagation()}`** in addition to `onClick={(e) => e.stopPropagation()}`.
- *Rationale*: Parent containers invoke `setPointerCapture` on `onPointerDown`. Stopping propagation on `pointerdown` prevents parent drag handlers from hijacking pointer capture before button click events can fire.

---

## 4. Timeline & Track Layer Governance

### Overlay Track Layer (`.st-track-overlay`)
- **Track Height**: `38px`
- **Pill Min-Width**: `100px` (prevents text clipping on short durations)
- **Active / Selected State**: `border: 2px solid #fff` with `zIndex: 10`
- **Remove Button**: Use vector SVG cross icons (9px x 9px line stroke) inside an 18px circle, never raw unicode text characters like `x` or `X`.

---

## 5. Modals & Slide-Over Drawers

### Scrim & Overlay
- **Class**: `.st-modal-scrim`
- **Background**: `rgba(0, 0, 0, 0.65)` with `backdrop-filter: blur(4px)`
- **Z-Index**: `999` (or `1000` for higher drawers)

### Card Container
- **Class**: `.st-modal-card`
- **Background**: `var(--panel-2)`
- **Border**: `1px solid var(--line)`
- **Border Radius**: `12px`
- **Shadow**: `0 24px 60px rgba(0, 0, 0, 0.7)`

### Close Buttons
- **CRITICAL RULE**: Every modal, drawer, and dismissible panel close affordance **MUST** render an **`x` SVG icon** — never a raw unicode character (`×`, `✕`, `x`) and never a text label like `Close`.
- **Icon**: two crossing lines in a `viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth="2.2"`, `strokeLinecap="round"`, sized `14–16px`.
- **Color / Hover**: `color: var(--ink-2)`; on hover raise to `var(--ink)` with a `var(--panel-3)` background chip (`borderRadius: 7px`).
- **Accessibility**: always include `aria-label="Close"` and `title="Close (Esc)"`; wire `Esc` to the same handler.

```tsx
<button className="x" onClick={onClose} aria-label="Close" title="Close (Esc)">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
</button>
```

---

## 6. Pre-Commit Checklist for New UI Features

Before declaring any UI task completed, verify:
- [ ] No hardcoded color strings (e.g., `#0075ff`, `#ffffff`, `#000000` where theme tokens apply).
- [ ] All range sliders use `var(--accent)` and `var(--panel-3)` track fill.
- [ ] Grouped labeled sliders use the compact **name (70px) · slider · value (32px)** single-row layout.
- [ ] All on/off toggles use the reusable `<Switch>` component (not raw checkboxes or inline markup).
- [ ] Every close affordance uses the `x` SVG icon (no unicode `×`/`✕` or `Close` text) with `aria-label="Close"` and `Esc` wired.
- [ ] Interactive buttons inside draggable elements include `onPointerDown={(e) => e.stopPropagation()}`.
- [ ] UI tested in both **Dark Mode** and **Light Mode**.
- [ ] `npm test && npm run build` completes with 0 errors.
