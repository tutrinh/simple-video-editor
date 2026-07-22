# Agent Governance & Design System Rule

## UI Component Design Governance
When creating, editing, or refactoring UI components or styling in this repository:

1. **Strictly adhere to [DESIGN_PATTERNS.md](file:///Users/prime/Documents/Web/projects/simple-video-editor/DESIGN_PATTERNS.md)**.
2. **Never hardcode arbitrary hex colors** (e.g. `#0075ff` blue) or native browser defaults. Always consume CSS variable tokens (`var(--bg)`, `var(--panel)`, `var(--panel-2)`, `var(--panel-3)`, `var(--line)`, `var(--ink)`, `var(--accent)`).
3. **Range Sliders**: Must use `accentColor: "var(--accent)"` and `background: linear-gradient(..., var(--panel-3))` for track fills to maintain 100% theme consistency across inspectors.
4. **Interactive Action Buttons in Draggable Items**: Always attach `onPointerDown={(e) => e.stopPropagation()}` to prevent drag pointer capture from swallowing button click events.
5. **Theme Testing**: Always verify components render seamlessly in both **Dark Mode** and **Light Mode**.
6. **Video Media & Blob URL Safety**: **Strictly observe [PREVIEW_BLACK_SCREEN_PREVENTION.md](file:///Users/prime/Documents/Web/projects/simple-video-editor/PREVIEW_BLACK_SCREEN_PREVENTION.md)**. Always use `getClipBlobUrl(src)` from `src/lib/blobUrlCache.ts`. NEVER call `URL.createObjectURL` inside `useMemo` or invoke `URL.revokeObjectURL` in component cleanup effects on active clips.
