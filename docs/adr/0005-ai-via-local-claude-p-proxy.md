# AI calls run through local Claude or Codex CLI proxies, not browser API keys

ADR-0002 chose "fully client-side, Claude API key in the browser." We're
replacing the AI-auth half of that: the app no longer uses an Anthropic API key.
Instead, dev-only Vite middleware shells out to one of two locally authenticated
CLIs. `/api/claude` runs `claude -p`; `/api/codex` runs an ephemeral, read-only
`codex exec`. The browser POSTs `{ prompt, images, model }`; the proxy writes any
frames to temporary files, attaches them to the selected CLI, and returns text.
Claude receives a mapped `--model` alias. Codex uses the default model from its
own CLI configuration because the app's saved model ids are Claude-specific.

**Why:** no API key to obtain, store, or expose — the user is already logged into
Claude Code or Codex. It removes the one piece of ADR-0002 that was a genuine
wart (a live key sitting in client JS) while allowing either supported CLI to
analyze frames and author/refine the Script.

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
