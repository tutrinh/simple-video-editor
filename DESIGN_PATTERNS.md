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

### Text Inputs, Numbers, & Select Dropdowns
- **Background**: `var(--panel-3)`
- **Border**: `1px solid var(--line)`
- **Text Color**: `var(--ink)`
- **Border Radius**: `6px`
- **Padding**: `4px 8px`

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

---

## 6. Pre-Commit Checklist for New UI Features

Before declaring any UI task completed, verify:
- [ ] No hardcoded color strings (e.g., `#0075ff`, `#ffffff`, `#000000` where theme tokens apply).
- [ ] All range sliders use `var(--accent)` and `var(--panel-3)` track fill.
- [ ] Interactive buttons inside draggable elements include `onPointerDown={(e) => e.stopPropagation()}`.
- [ ] UI tested in both **Dark Mode** and **Light Mode**.
- [ ] `npm test && npm run build` completes with 0 errors.
