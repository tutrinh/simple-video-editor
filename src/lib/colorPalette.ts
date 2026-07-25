// The editor's one colour palette (ADR-0013). Mirrors stickerLibrary.ts's
// favourites: localStorage, GLOBAL rather than per-Project — a colour the author
// reaches for is a property of the author, not of one edit.

const PALETTE_KEY = "vidstr_color_palette";

/** Seeds the palette on first read. Not an immutable tier — these are removable. */
export const DEFAULT_PALETTE = [
  "#ffffff", "#000000", "#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#af52de",
];

/**
 * A rolling cap. New colours append rather than sorting to the front — a
 * palette that reorders on every pick moves swatches out from under the cursor
 * — so overflow drops from the front, the one rule that keeps the row bounded
 * without silently refusing to add.
 */
export const MAX_PALETTE = 20;

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The one place hex is canonicalised: lowercase `#rrggbb`, shorthand expanded.
 * Returns null for anything that is not a hex colour, so callers can reject
 * rather than storing junk that would render as a transparent swatch.
 */
export function normalizeHex(input: string): string | null {
  // Guard the type rather than coercing: String(123) is "123", which would
  // parse as the shorthand #112233 and quietly put a colour nobody picked into
  // the palette.
  if (typeof input !== "string") return null;
  const m = input.trim().match(HEX_RE);
  if (!m) return null;
  const body = m[1].toLowerCase();
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  return `#${full}`;
}

export function loadPalette(): string[] {
  try {
    if (typeof localStorage === "undefined") return [...DEFAULT_PALETTE];
    const raw = localStorage.getItem(PALETTE_KEY);
    if (!raw) return [...DEFAULT_PALETTE];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PALETTE];
    const clean = dedupe(parsed.map((c) => (typeof c === "string" ? normalizeHex(c) : null)));
    // An array that held nothing usable is corrupt, not "an empty palette the
    // author curated" — an empty row would leave no way back to the defaults.
    return clean.length ? clean : [...DEFAULT_PALETTE];
  } catch {
    /* corrupt storage degrades to the defaults */
  }
  return [...DEFAULT_PALETTE];
}

function dedupe(colors: (string | null)[]): string[] {
  const out: string[] = [];
  for (const c of colors) if (c && !out.includes(c)) out.push(c);
  return out;
}

function persist(colors: string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PALETTE_KEY, JSON.stringify(colors));
  } catch {
    /* quota or private mode — the palette is a convenience, not state */
  }
  emit(colors);
}

/** Add a colour to the end of the palette; returns the new palette. */
export function addPaletteColor(hex: string): string[] {
  const norm = normalizeHex(hex);
  const current = loadPalette();
  if (!norm || current.includes(norm)) return current;
  const next = [...current, norm];
  persist(next.length > MAX_PALETTE ? next.slice(next.length - MAX_PALETTE) : next);
  return loadPalette();
}

/** Remove a colour — defaults included; returns the new palette. */
export function removePaletteColor(hex: string): string[] {
  const norm = normalizeHex(hex);
  const current = loadPalette();
  if (!norm || !current.includes(norm)) return current;
  persist(current.filter((c) => c !== norm));
  return loadPalette();
}

// Every mounted ColorField shares one palette, so adding a colour in the Sticker
// row has to update the Title row without a remount.
type Listener = (colors: string[]) => void;
const listeners = new Set<Listener>();

function emit(colors: string[]): void {
  for (const l of [...listeners]) {
    try { l(colors); } catch { /* one bad subscriber must not break the rest */ }
  }
}

/** Subscribe to palette changes; returns the unsubscribe. */
export function subscribePalette(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
