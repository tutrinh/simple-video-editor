# AI calls run through a local `claude -p` proxy, not an in-browser API key

ADR-0002 chose "fully client-side, Claude API key in the browser." We're
replacing the AI-auth half of that: the app no longer uses an Anthropic API key.
Instead, a **dev-only Vite middleware** at `/api/claude` shells out to the
`claude -p` CLI, which authenticates with the user's existing Claude Code login.
The browser POSTs `{ prompt, images, model }`; the proxy writes any frames to
temp files, runs `claude -p` (with `--allowedTools Read` for vision and a mapped
`--model` alias), and returns the text.

**Why:** no API key to obtain, store, or expose — the user is already logged into
Claude Code, and the spikes proved `claude -p` describes frames well. It removes
the one piece of ADR-0002 that was a genuine wart (a live key sitting in client
JS).

**What this changes vs ADR-0002:**
- **Video stays 100% client-side** — `ffmpeg.wasm` ingest/export are unchanged.
  ADR-0002's render decisions all still hold.
- There is now a **local backend**, but only the Vite dev server during
  `npm run dev`. It is not deployed; it runs on the user's own machine for a
  personal tool. A hosted build would need a real proxy (or revert to an API key).
- **Per-stage model** is coarser: Claude Code exposes `opus`/`sonnet`/`haiku`
  aliases, so the full model ids are mapped down to those.

**Consequence:** `vite build` / `vite preview` have no proxy — AI calls only work
under `npm run dev`. Acceptable for a personal dev tool; revisit if this is ever
hosted.
